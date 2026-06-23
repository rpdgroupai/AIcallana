import os
import json
import tempfile
import traceback
import secrets
from pathlib import Path
from flask import Flask, render_template, request, jsonify, session
from werkzeug.utils import secure_filename
from dotenv import load_dotenv
from google import genai
from google.genai import types
from google.genai.errors import APIError

load_dotenv()

app = Flask(__name__)
app.secret_key = os.environ.get('FLASK_SECRET_KEY', secrets.token_hex(32))
app.config['MAX_CONTENT_LENGTH'] = 200 * 1024 * 1024  # 200MB max upload
app.config['UPLOAD_FOLDER'] = tempfile.mkdtemp()

ALLOWED_EXTENSIONS = {'mp3', 'wav', 'ogg', 'flac', 'webm', 'm4a', 'aac', 'wma'}

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

KEYS_FILE = 'agent_keys.json'

def load_keys():
    if os.path.exists(KEYS_FILE):
        with open(KEYS_FILE) as f:
            return json.load(f)
    return {}

def save_keys(keys):
    with open(KEYS_FILE, 'w') as f:
        json.dump(keys, f, indent=2)

def get_agent_gemini_key(agent_id: str):
    keys = load_keys()
    agent_key = keys.get(agent_id, {}).get('gemini', '').strip()
    return agent_key or os.environ.get('GEMINI_API_KEY') or None

def get_agent_sarvam_key(agent_id: str):
    keys = load_keys()
    agent_key = keys.get(agent_id, {}).get('sarvam', '').strip()
    return agent_key or os.environ.get('SARVAM_API_KEY') or None

async def run_speechmatics_transcription(filepath, api_key):
    from speechmatics.batch import AsyncClient, TranscriptionConfig, Model
    async with AsyncClient(api_key=api_key) as client:
        config = TranscriptionConfig(
            language="en",
            model=Model.ENHANCED,
        )
        result = await client.transcribe(
            filepath,
            transcription_config=config,
        )
        return result.transcript_text


@app.route('/')
def index():
    agent_id = session.get('agent_id') or request.args.get('agent') or ''
    return render_template('index.html', agent_id=agent_id)

@app.route('/agent/<agent_name>')
def agent_dashboard(agent_name):
    """Agent-specific dashboard — sets session and renders index"""
    session['agent_id'] = agent_name
    return render_template('index.html', agent_id=agent_name)

@app.route('/api/current-agent')
def current_agent():
    """Returns which agent is currently logged in (from session or query param)"""
    agent_id = session.get('agent_id') or request.args.get('agent')
    if not agent_id:
        return jsonify({'agent': None})
    keys = load_keys()
    agent_data = keys.get(agent_id, {})
    return jsonify({
        'agent': agent_id,
        'has_gemini': bool(agent_data.get('gemini')),
        'has_sarvam': bool(agent_data.get('sarvam')),
        'has_speechmatics': bool(agent_data.get('speechmatics'))
    })

@app.route('/api/analyze-agent', methods=['POST'])
def api_analyze_agent():
    """Same as /api/analyze but pulls key from agent session automatically"""
    agent_id = request.form.get('agent_id') or session.get('agent_id')
    if not agent_id:
        return jsonify({'error': 'No agent session. Open your personal link first.'}), 400
    
    keys = load_keys()
    agent_keys = keys.get(agent_id, {})
    gemini_key = agent_keys.get('gemini') or os.environ.get('GEMINI_API_KEY')
    sarvam_key = agent_keys.get('sarvam') or os.environ.get('SARVAM_API_KEY')
    speechmatics_key = agent_keys.get('speechmatics') or os.environ.get('SPEECHMATICS_API_KEY')
    
    if not gemini_key:
        return jsonify({'error': f'No Gemini key configured for agent {agent_id}. Ask manager to add it at /keys'}), 400

    # Inject keys into headers and forward to existing analyze logic
    # by calling it internally with the right headers
    request.environ['HTTP_X_GEMINI_API_KEY'] = gemini_key
    if sarvam_key:
        request.environ['HTTP_X_SARVAM_API_KEY'] = sarvam_key
    if speechmatics_key:
        request.environ['HTTP_X_SPEECHMATICS_API_KEY'] = speechmatics_key
    
    return api_analyze()


@app.route('/api/analyze', methods=['POST'])
def api_analyze():
    """Upload audio, transcribe (using Gemini or Sarvam AI) and generate a call intelligence report using Gemini."""
    if 'audio' not in request.files:
        return jsonify({"error": "No audio file provided"}), 400

    file = request.files['audio']
    if file.filename == '':
        return jsonify({"error": "No file selected"}), 400

    if not allowed_file(file.filename):
        return jsonify({"error": f"File type not allowed. Supported: {', '.join(ALLOWED_EXTENSIONS)}"}), 400

    # Get model and keys
    transcription_model = request.form.get('transcription_model', 'gemini')

    agent_id = (request.form.get('agent_id') or '').strip()

    if agent_id:
        gemini_key = get_agent_gemini_key(agent_id)
        sarvam_key = get_agent_sarvam_key(agent_id)
        speechmatics_key = os.environ.get('SPEECHMATICS_API_KEY')
    else:
        gemini_key = request.headers.get('X-Gemini-API-Key') or os.environ.get('GEMINI_API_KEY')
        sarvam_key = request.headers.get('X-Sarvam-API-Key') or os.environ.get('SARVAM_API_KEY')
        speechmatics_key = request.headers.get('X-Speechmatics-API-Key') or os.environ.get('SPEECHMATICS_API_KEY')

    if not gemini_key:
        return jsonify({
            "error": "Gemini API Key is missing. Please configure your API key in the settings (gear icon in the top right)."
        }), 400

    filepath = None
    uploaded_file = None
    client = None
    try:
        filename = secure_filename(file.filename)
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(filepath)

        # Initialize Google Gen AI client (used for analysis in both modes)
        client = genai.Client(api_key=gemini_key)

        transcript = ""

        if transcription_model == 'sarvam':
            # Use Sarvam AI Batch API for transcription (supports up to 2 hours of audio)
            sarvam_key = request.headers.get('X-Sarvam-API-Key') or os.environ.get('SARVAM_API_KEY')
            if not sarvam_key:
                return jsonify({
                    "error": "Sarvam AI API Key is missing. Please configure your API key in the settings."
                }), 400
            
            print(f"Transcribing audio using Sarvam AI Batch API (saaras:v3)...")
            from sarvamai import SarvamAI
            import glob
            sarvam_client = SarvamAI(api_subscription_key=sarvam_key)
            
            # Create a batch transcription job
            job = sarvam_client.speech_to_text_job.create_job(
                model="saaras:v3",
                mode="transcribe",
                language_code="unknown",   # auto-detect: works for Marathi, Hindi, English
                with_diarization=False
            )
            
            # Upload the audio file
            job.upload_files(file_paths=[filepath])
            
            # Start and wait for completion
            job.start()
            print("Sarvam AI batch job started. Waiting for completion...")
            job.wait_until_complete()
            
            # Download outputs to a temp directory and read the transcript JSON
            transcript_parts = []
            with tempfile.TemporaryDirectory() as tmp_out:
                job.download_outputs(output_dir=tmp_out)
                json_files = glob.glob(f"{tmp_out}/*.json")
                for jf in sorted(json_files):
                    with open(jf, "r", encoding="utf-8") as fh:
                        data = json.load(fh)
                    # Sarvam batch output: list of segments or a transcript field
                    if isinstance(data, list):
                        for seg in data:
                            t = seg.get("transcript", seg.get("text", ""))
                            if t:
                                transcript_parts.append(t.strip())
                    elif isinstance(data, dict):
                        t = data.get("transcript", data.get("text", ""))
                        if t:
                            transcript_parts.append(t.strip())
            
            transcript = " ".join(transcript_parts).strip()
            if not transcript:
                transcript = "(Sarvam AI returned an empty transcript)"
            
            print(f"Sarvam AI Batch Transcription complete. Characters: {len(transcript)}")
            
            # Analyze using Gemini via text prompt
            prompt = f"""You are an expert call analyst. Read the following call transcript and produce a comprehensive call intelligence report in English.

Transcript:
{transcript}

Return ONLY a valid JSON object matching the schema below. No markdown fences (do not wrap in ```json), no preambles, no trailing text.

JSON Schema:
{{
  "report": {{
    "call_language": "Languages detected in the call e.g. Marathi, English, Marathi-English mixed",
    "participants": {{
      "person_a": "Name or role of Speaker 1 (e.g. Agent/Customer)",
      "person_b": "Name or role of Speaker 2"
    }},
    "call_overview": {{
      "purpose": "One sentence — why was this call made? What was the context?",
      "outcome": "One sentence — how did the call end? Was the purpose achieved?",
      "duration_estimate": "Short / Medium / Long based on transcript length"
    }},
    "full_summary": "A natural, well-written paragraph in English summarizing the entire conversation from start to finish.",
    "key_points": [
      "Most important point discussed",
      "Second most important point"
    ],
    "decisions_made": [
      "Any decision agreed upon during the call"
    ],
    "commitments": [
      {{
        "by": "Person A or Person B",
        "commitment": "What they said they would do"
      }}
    ],
    "questions_raised": [
      "Any question that was asked but not answered or needs follow-up"
    ],
    "action_items": [
      {{
        "action": "What needs to be done",
        "owner": "Who is responsible",
        "urgency": "Immediate / Soon / Whenever"
      }}
    ],
    "sentiment": {{
      "overall_tone": "Positive / Neutral / Tense / Frustrated / Productive",
      "person_a_mood": "Calm / Excited / Frustrated / Professional / Aggressive",
      "person_b_mood": "Calm / Excited / Frustrated / Professional / Aggressive",
      "notable_moments": "Any standout moment in the call (e.g. argument, breakthrough) or null"
    }},
    "red_alerts": [
      "CRITICAL: List any incorrect details given, policy/procedure violations, bad behavior, mistakes, customer complaints, or things done wrong during the call in a clear, alarming manner."
    ],
    "red_flags": [
      "General concerning points or future risk factors (e.g. slow response times, budget limits)"
    ],
    "topics_mentioned": [
      "Flat list of all subjects that came up"
    ],
    "original_language_notes": "Explanation of any specific Marathi phrases or cultural context, or null"
  }}
}}"""
            print("Requesting Gemini to analyze Sarvam AI transcript...")
            response = client.models.generate_content(
                model='gemini-2.5-flash',
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                ),
            )
            result_text = response.text
            parsed_analysis = json.loads(result_text)
            
            # Package together
            return jsonify({
                "transcript": transcript,
                "report": parsed_analysis.get("report", parsed_analysis)
            })

        elif transcription_model == 'speechmatics':
            speechmatics_key = request.headers.get('X-Speechmatics-API-Key') or os.environ.get('SPEECHMATICS_API_KEY')
            if not speechmatics_key:
                return jsonify({
                    "error": "Speechmatics API Key is missing. Please configure your API key in the settings."
                }), 400
            
            print(f"Transcribing audio using Speechmatics Async API...")
            import asyncio
            try:
                transcript = asyncio.run(run_speechmatics_transcription(filepath, speechmatics_key))
            except Exception as e:
                traceback.print_exc()
                return jsonify({"error": f"Speechmatics transcription failed: {str(e)}"}), 500
            
            if not transcript:
                transcript = "(Speechmatics returned an empty transcript)"
            
            print(f"Speechmatics transcription complete. Characters: {len(transcript)}")
            
            # Analyze using Gemini via text prompt
            prompt = f"""You are an expert call analyst. Read the following call transcript and produce a comprehensive call intelligence report in English.

Transcript:
{transcript}

Return ONLY a valid JSON object matching the schema below. No markdown fences (do not wrap in ```json), no preambles, no trailing text.

JSON Schema:
{{
  "report": {{
    "call_language": "Languages detected in the call e.g. Marathi, English, Marathi-English mixed",
    "participants": {{
      "person_a": "Name or role of Speaker 1 (e.g. Agent/Customer)",
      "person_b": "Name or role of Speaker 2"
    }},
    "call_overview": {{
      "purpose": "One sentence — why was this call made? What was the context?",
      "outcome": "One sentence — how did the call end? Was the purpose achieved?",
      "duration_estimate": "Short / Medium / Long based on transcript length"
    }},
    "full_summary": "A natural, well-written paragraph in English summarizing the entire conversation from start to finish.",
    "key_points": [
      "Most important point discussed",
      "Second most important point"
    ],
    "decisions_made": [
      "Any decision agreed upon during the call"
    ],
    "commitments": [
      {{
        "by": "Person A or Person B",
        "commitment": "What they said they would do"
      }}
    ],
    "questions_raised": [
      "Any question that was asked but not answered or needs follow-up"
    ],
    "action_items": [
      {{
        "action": "What needs to be done",
        "owner": "Who is responsible",
        "urgency": "Immediate / Soon / Whenever"
      }}
    ],
    "sentiment": {{
      "overall_tone": "Positive / Neutral / Tense / Frustrated / Productive",
      "person_a_mood": "Calm / Excited / Frustrated / Professional / Aggressive",
      "person_b_mood": "Calm / Excited / Frustrated / Professional / Aggressive",
      "notable_moments": "Any standout moment in the call (e.g. argument, breakthrough) or null"
    }},
    "red_alerts": [
      "CRITICAL: List any incorrect details given, policy/procedure violations, bad behavior, mistakes, customer complaints, or things done wrong during the call in a clear, alarming manner."
    ],
    "red_flags": [
      "General concerning points or future risk factors (e.g. slow response times, budget limits)"
    ],
    "topics_mentioned": [
      "Flat list of all subjects that came up"
    ],
    "original_language_notes": "Explanation of any specific Marathi phrases or cultural context, or null"
  }}
}}"""
            print("Requesting Gemini to analyze Speechmatics transcript...")
            response = client.models.generate_content(
                model='gemini-2.5-flash',
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                ),
            )
            result_text = response.text
            parsed_analysis = json.loads(result_text)
            
            # Package together
            return jsonify({
                "transcript": transcript,
                "report": parsed_analysis.get("report", parsed_analysis)
            })

        else:
            # Use Gemini for both transcription and analysis
            # Upload file to Gemini File API
            print(f"Uploading file to Gemini File API: {filename}")
            uploaded_file = client.files.upload(file=filepath)
            print(f"File uploaded. URI: {uploaded_file.uri}")

            # Construct prompt for transcription and analysis
            prompt = """You are an expert call analyst. Read/listen to the attached audio file and perform two tasks:
1. Provide a verbatim, high-quality transcript of the conversation in the original languages spoken (primarily Marathi, or Marathi-Hindi-English mixed).
2. Generate a comprehensive call intelligence report in English.

Return ONLY a valid JSON object matching the schema below. No markdown fences (do not wrap in ```json), no preambles, no trailing text.

JSON Schema:
{
  "transcript": "Verbatim transcript of the call in its original spoken languages (primarily Marathi / mixed).",
  "report": {
    "call_language": "Languages detected in the call e.g. Marathi, English, Marathi-English mixed",
    "participants": {
      "person_a": "Name or role of Speaker 1 (e.g. Agent/Customer)",
      "person_b": "Name or role of Speaker 2"
    },
    "call_overview": {
      "purpose": "One sentence — why was this call made? What was the context?",
      "outcome": "One sentence — how did the call end? Was the purpose achieved?",
      "duration_estimate": "Short / Medium / Long based on transcript length"
    },
    "full_summary": "A natural, well-written paragraph in English summarizing the entire conversation from start to finish.",
    "key_points": [
      "Most important point discussed",
      "Second most important point"
    ],
    "decisions_made": [
      "Any decision agreed upon during the call"
    ],
    "commitments": [
      {
        "by": "Person A or Person B",
        "commitment": "What they said they would do"
      }
    ],
    "questions_raised": [
      "Any question that was asked but not answered or needs follow-up"
    ],
    "action_items": [
      {
        "action": "What needs to be done",
        "owner": "Who is responsible",
        "urgency": "Immediate / Soon / Whenever"
      }
    ],
    "sentiment": {
      "overall_tone": "Positive / Neutral / Tense / Frustrated / Productive",
      "person_a_mood": "Calm / Excited / Frustrated / Professional / Aggressive",
      "person_b_mood": "Calm / Excited / Frustrated / Professional / Aggressive",
      "notable_moments": "Any standout moment in the call (e.g. argument, breakthrough) or null"
    },
    "red_alerts": [
      "CRITICAL: List any incorrect details given, policy/procedure violations, bad behavior, mistakes, customer complaints, or things done wrong during the call in a clear, alarming manner."
    ],
    "red_flags": [
      "General concerning points or future risk factors (e.g. slow response times, budget limits)"
    ],
    "topics_mentioned": [
      "Flat list of all subjects that came up"
    ],
    "original_language_notes": "Explanation of any specific Marathi phrases or cultural context, or null"
  }
}"""

            print("Requesting Gemini to transcribe and analyze call...")
            response = client.models.generate_content(
                model='gemini-2.5-flash',
                contents=[uploaded_file, prompt],
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                ),
            )

            result_text = response.text
            parsed_result = json.loads(result_text)
            return jsonify(parsed_result)

    except APIError as ae:
        traceback.print_exc()
        return jsonify({"error": f"Gemini API Error: {ae.message}"}), 500
    except json.JSONDecodeError:
        traceback.print_exc()
        return jsonify({"error": "Failed to parse analysis response as JSON from Gemini."}), 500
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": f"Processing failed: {str(e)}"}), 500
    finally:
        # Clean up local file
        if filepath and os.path.exists(filepath):
            try:
                os.remove(filepath)
            except OSError:
                pass
        # Clean up Gemini hosted file
        if client and uploaded_file:
            try:
                print(f"Deleting file from Gemini API storage: {uploaded_file.name}")
                client.files.delete(name=uploaded_file.name)
            except Exception as e:
                print(f"Failed to delete file from Gemini storage: {e}")


@app.route('/keys')
def keys_page():
    return render_template('keys.html')

@app.route('/api/agent-keys', methods=['GET'])
def get_agent_keys():
    return jsonify(load_keys())

@app.route('/api/agent-keys', methods=['POST'])
def save_agent_key():
    data = request.json
    agent = (data.get('agent') or '').strip()
    gemini = (data.get('gemini') or '').strip()
    sarvam = (data.get('sarvam') or '').strip()
    speechmatics = (data.get('speechmatics') or '').strip()
    
    if not agent:
        return jsonify({'error': 'Agent name required'}), 400
    
    keys = load_keys()
    keys[agent] = {
        'gemini': gemini,
        'sarvam': sarvam,
        'speechmatics': speechmatics
    }
    save_keys(keys)
    return jsonify({'success': True})

@app.route('/api/agent-keys/<agent>', methods=['DELETE'])
def delete_agent_key(agent):
    keys = load_keys()
    if agent in keys:
        del keys[agent]
        save_keys(keys)
    return jsonify({'success': True})


if __name__ == '__main__':
    print("=" * 60)
    print("  Call Analyzer — Unified Gemini API Edition")
    print("  Transcription: Gemini 2.5 Flash / Sarvam AI (Saaras v3)")
    print("  Analysis:      Gemini 2.5 Flash")
    print("  Open http://localhost:5000 in your browser")
    print("=" * 60)
    app.run(debug=False, host='0.0.0.0', port=5000)


