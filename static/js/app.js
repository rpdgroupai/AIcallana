document.addEventListener('DOMContentLoaded', () => {
    // Elements
    const dropzone = document.getElementById('dropzone');
    const fileInput = document.getElementById('file-input');
    const filePreview = document.getElementById('file-preview');
    const fileName = document.getElementById('file-name');
    const fileSize = document.getElementById('file-size');
    const fileRemove = document.getElementById('file-remove');
    const generateBtn = document.getElementById('generate-btn');
    
    const processingSection = document.getElementById('processing-section');
    const processingTitle = document.getElementById('processing-title');
    const processingDesc = document.getElementById('processing-desc');
    const progressBar = document.getElementById('progress-bar');
    
    const errorSection = document.getElementById('error-section');
    const errorMessage = document.getElementById('error-message');
    const retryBtn = document.getElementById('retry-btn');
    
    const resultsSection = document.getElementById('results-section');
    const transcriptText = document.getElementById('transcript-text');
    const reportBody = document.getElementById('report-body');
    const copyTranscriptBtn = document.getElementById('copy-transcript-btn');
    const copyReportBtn = document.getElementById('copy-report-btn');
    
    // Step indicators
    const stepUpload = document.getElementById('step-upload');
    const stepTranscribe = document.getElementById('step-transcribe');
    const stepReport = document.getElementById('step-report');
    
    const connector1 = document.getElementById('connector-1');
    const connector2 = document.getElementById('connector-2');

    // Settings Modal Elements
    const settingsBtn = document.getElementById('settings-btn');
    const settingsModal = document.getElementById('settings-modal');
    const modalClose = document.getElementById('modal-close');
    const modalCancelBtn = document.getElementById('modal-cancel-btn');
    const modalSaveBtn = document.getElementById('modal-save-btn');
    const apiKeyInput = document.getElementById('api-key-input');
    const sarvamKeyInput = document.getElementById('sarvam-key-input');
    const speechmaticsKeyInput = document.getElementById('speechmatics-key-input');
    const modelSelect = document.getElementById('model-select');
    const transcriptBadge = document.getElementById('transcript-badge');

    let selectedFile = null;
    let fullReportJson = null;

    // Load API Keys from localStorage
    apiKeyInput.value = localStorage.getItem('gemini_api_key') || '';
    sarvamKeyInput.value = localStorage.getItem('sarvam_api_key') || '';
    speechmaticsKeyInput.value = localStorage.getItem('speechmatics_api_key') || '';

    // Modal Events
    settingsBtn.addEventListener('click', () => {
        settingsModal.classList.remove('hidden');
    });

    const closeModal = () => {
        settingsModal.classList.add('hidden');
        apiKeyInput.value = localStorage.getItem('gemini_api_key') || '';
        sarvamKeyInput.value = localStorage.getItem('sarvam_api_key') || '';
        speechmaticsKeyInput.value = localStorage.getItem('speechmatics_api_key') || '';
    };

    modalClose.addEventListener('click', closeModal);
    modalCancelBtn.addEventListener('click', closeModal);
    document.getElementById('modal-overlay').addEventListener('click', closeModal);

    modalSaveBtn.addEventListener('click', () => {
        const geminiKey = apiKeyInput.value.trim();
        const sarvamKey = sarvamKeyInput.value.trim();
        const speechmaticsKey = speechmaticsKeyInput.value.trim();
        localStorage.setItem('gemini_api_key', geminiKey);
        localStorage.setItem('sarvam_api_key', sarvamKey);
        localStorage.setItem('speechmatics_api_key', speechmaticsKey);
        settingsModal.classList.add('hidden');
    });

    // Drag and Drop events
    ['dragenter', 'dragover'].forEach(eventName => {
        dropzone.addEventListener(eventName, (e) => {
            e.preventDefault();
            dropzone.classList.add('dragover');
        }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropzone.addEventListener(eventName, (e) => {
            e.preventDefault();
            dropzone.classList.remove('dragover');
        }, false);
    });

    dropzone.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        const files = dt.files;
        if (files.length > 0) {
            handleFileSelect(files[0]);
        }
    });

    dropzone.addEventListener('click', () => {
        fileInput.click();
    });

    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleFileSelect(e.target.files[0]);
        }
    });

    fileRemove.addEventListener('click', (e) => {
        e.stopPropagation();
        resetUpload();
    });

    retryBtn.addEventListener('click', () => {
        errorSection.classList.add('hidden');
        dropzone.parentNode.classList.remove('hidden');
        resetUpload();
    });

    function handleFileSelect(file) {
        selectedFile = file;
        fileName.textContent = file.name;
        
        // Format size
        const sizeKB = file.size / 1024;
        if (sizeKB > 1024) {
            fileSize.textContent = `${(sizeKB / 1024).toFixed(1)} MB`;
        } else {
            fileSize.textContent = `${sizeKB.toFixed(0)} KB`;
        }

        dropzone.classList.add('hidden');
        filePreview.classList.remove('hidden');
        generateBtn.disabled = false;
        
        // Update steps indicator
        updateSteps('upload');
    }

    function resetUpload() {
        selectedFile = null;
        fileInput.value = '';
        filePreview.classList.add('hidden');
        dropzone.classList.remove('hidden');
        generateBtn.disabled = true;
        updateSteps('reset');
    }

    function updateSteps(stage) {
        // Reset all steps first
        stepUpload.className = 'pipeline-step';
        stepTranscribe.className = 'pipeline-step';
        stepReport.className = 'pipeline-step';
        
        connector1.className = 'pipeline-connector';
        connector2.className = 'pipeline-connector';

        if (stage === 'reset') {
            stepUpload.classList.add('active');
            return;
        }

        stepUpload.classList.add('completed');
        
        if (stage === 'upload') {
            stepTranscribe.classList.add('active');
            connector1.classList.add('active');
        } else if (stage === 'transcribe') {
            stepTranscribe.classList.add('completed');
            connector1.classList.add('completed');
            stepReport.classList.add('active');
            connector2.classList.add('active');
        } else if (stage === 'report') {
            stepTranscribe.classList.add('completed');
            connector1.classList.add('completed');
            stepReport.classList.add('completed');
            connector2.classList.add('completed');
        }
    }

    // Trigger generate report flow
    generateBtn.addEventListener('click', async () => {
        if (!selectedFile) return;

        // Hide upload panel, show processing panel
        dropzone.parentNode.classList.add('hidden');
        processingSection.classList.remove('hidden');
        resultsSection.classList.add('hidden');
        errorSection.classList.add('hidden');

        try {
            // STEP 1: Upload and Process
            updateSteps('upload');
            const selectedModel = modelSelect.value;
            let modelName = "Gemini 2.5 Flash";
            if (selectedModel === 'sarvam') {
                modelName = "Sarvam AI (Saaras v3)";
            } else if (selectedModel === 'speechmatics') {
                modelName = "Speechmatics (Enhanced)";
            }
            
            processingTitle.textContent = `Processing Call with ${modelName}...`;
            processingDesc.textContent = `Uploading audio, generating transcription via ${modelName}, and compiling a structured intelligence report. This may take 15-50 seconds.`;
            
            const formData = new FormData();
            formData.append('audio', selectedFile);
            formData.append('transcription_model', selectedModel);

            const headers = {};
            const key = localStorage.getItem('gemini_api_key');
            if (key) {
                headers['X-Gemini-API-Key'] = key;
            }
            const sarvamKey = localStorage.getItem('sarvam_api_key');
            if (sarvamKey) {
                headers['X-Sarvam-API-Key'] = sarvamKey;
            }
            const speechmaticsKey = localStorage.getItem('speechmatics_api_key');
            if (speechmaticsKey) {
                headers['X-Speechmatics-API-Key'] = speechmaticsKey;
            }

            const currentAgentId = document.body.dataset.agentId;
            const endpoint = currentAgentId ? '/api/analyze-agent' : '/api/analyze';

            const response = await fetch(endpoint, {
                method: 'POST',
                headers: headers,
                body: formData
            });

            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.error || "Processing failed");
            }

            updateSteps('transcribe');
            const data = await response.json();
            
            // Set transcript text in UI
            transcriptText.textContent = data.transcript || "No transcript returned.";
            
            // Update transcript badge label
            transcriptBadge.textContent = modelName;
            
            // Save and render full report JSON
            fullReportJson = data.report || {};
            renderReport(fullReportJson);

            // Complete UI Flow
            updateSteps('report');
            processingSection.classList.add('hidden');
            resultsSection.classList.remove('hidden');

        } catch (error) {
            console.error(error);
            processingSection.classList.add('hidden');
            errorSection.classList.remove('hidden');
            errorMessage.textContent = error.message || "An unexpected error occurred during processing.";
        }
    });

    function renderReport(report) {
        reportBody.innerHTML = ''; // Clear previous report content

        if (report.raw_report) {
            // Fallback for non-JSON or raw text responses
            const group = createReportGroup("Raw AI Output", "⚡");
            const pre = document.createElement('pre');
            pre.className = 'raw-container';
            pre.textContent = report.raw_report;
            group.appendChild(pre);
            reportBody.appendChild(group);
            return;
        }

        // Section 1: Overview & Metadata
        const metaGroup = createReportGroup("Overview & Participants", "📋");
        
        const grid = document.createElement('div');
        grid.className = 'meta-grid';
        
        grid.innerHTML = `
            <div class="meta-card">
                <div class="meta-label">Participants</div>
                <div class="meta-value">${report.participants?.person_a || 'Speaker 1'} &amp; ${report.participants?.person_b || 'Speaker 2'}</div>
            </div>
            <div class="meta-card">
                <div class="meta-label">Language(s)</div>
                <div class="meta-value">${report.call_language || 'Detected automatically'}</div>
            </div>
        `;
        metaGroup.appendChild(grid);

        const overviewCard = document.createElement('div');
        overviewCard.className = 'overview-card';
        overviewCard.style.marginTop = '1rem';
        overviewCard.innerHTML = `
            <div class="overview-item"><strong>Purpose:</strong> ${report.call_overview?.purpose || 'Not identified'}</div>
            <div class="overview-item"><strong>Outcome:</strong> ${report.call_overview?.outcome || 'Not identified'}</div>
            <div class="overview-item"><strong>Duration Estimate:</strong> ${report.call_overview?.duration_estimate || 'Not specified'}</div>
        `;
        metaGroup.appendChild(overviewCard);
        reportBody.appendChild(metaGroup);

        // Section 2: Full Journal Summary
        const summaryGroup = createReportGroup("Journal Summary", "✍️");
        const summaryCard = document.createElement('div');
        summaryCard.className = 'summary-card';
        summaryCard.textContent = report.full_summary || 'No summary generated.';
        summaryGroup.appendChild(summaryCard);
        reportBody.appendChild(summaryGroup);

        // Section 3: Sentiment & Moods
        const sentimentGroup = createReportGroup("Sentiment & Tone", "🎭");
        const sentimentGrid = document.createElement('div');
        sentimentGrid.className = 'sentiment-grid';
        sentimentGrid.innerHTML = `
            <div class="sentiment-pill">
                <span class="sentiment-pill-label">Overall Tone</span>
                <span class="sentiment-pill-value" style="color: ${getToneColor(report.sentiment?.overall_tone)}">${report.sentiment?.overall_tone || 'Neutral'}</span>
            </div>
            <div class="sentiment-pill">
                <span class="sentiment-pill-label">${report.participants?.person_a || 'Speaker 1'} Mood</span>
                <span class="sentiment-pill-value" style="color: ${getMoodColor(report.sentiment?.person_a_mood)}">${report.sentiment?.person_a_mood || 'Calm'}</span>
            </div>
            <div class="sentiment-pill" style="grid-column: span 2">
                <span class="sentiment-pill-label">${report.participants?.person_b || 'Speaker 2'} Mood</span>
                <span class="sentiment-pill-value" style="color: ${getMoodColor(report.sentiment?.person_b_mood)}">${report.sentiment?.person_b_mood || 'Calm'}</span>
            </div>
        `;
        sentimentGroup.appendChild(sentimentGrid);

        if (report.sentiment?.notable_moments) {
            const momentsCard = document.createElement('div');
            momentsCard.className = 'notable-moments-card';
            momentsCard.style.marginTop = '1rem';
            momentsCard.innerHTML = `<strong>Notable Moment:</strong> ${report.sentiment.notable_moments}`;
            sentimentGroup.appendChild(momentsCard);
        }
        reportBody.appendChild(sentimentGroup);

        // Section 3a: Red Alerts (If any)
        if (report.red_alerts && report.red_alerts.length > 0) {
            const alertsGroup = createReportGroup("Red Alerts / Call Mistakes", "🚨");
            const alertsCard = document.createElement('div');
            alertsCard.className = 'red-alerts-card';
            
            const ul = document.createElement('ul');
            ul.className = 'red-alerts-list';
            report.red_alerts.forEach(alert => {
                const li = document.createElement('li');
                li.className = 'red-alert-item';
                li.textContent = alert;
                ul.appendChild(li);
            });
            
            alertsCard.appendChild(ul);
            alertsGroup.appendChild(alertsCard);
            reportBody.appendChild(alertsGroup);
        }

        // Section 4: Red Flags (If any)
        if (report.red_flags && report.red_flags.length > 0) {
            const flagsGroup = createReportGroup("Red Flags & Concerns", "🔥");
            const flagsCard = document.createElement('div');
            flagsCard.className = 'red-flags-card';
            
            const ul = document.createElement('ul');
            ul.className = 'red-flags-list';
            report.red_flags.forEach(flag => {
                const li = document.createElement('li');
                li.className = 'red-flag-item';
                li.textContent = flag;
                ul.appendChild(li);
            });
            
            flagsCard.appendChild(ul);
            flagsGroup.appendChild(flagsCard);
            reportBody.appendChild(flagsGroup);
        }

        // Section 5: Key Discussion Points
        if (report.key_points && report.key_points.length > 0) {
            const pointsGroup = createReportGroup("Key Points Discussed", "💡");
            const ul = document.createElement('ul');
            ul.className = 'insights-list';
            report.key_points.forEach(point => {
                const li = document.createElement('li');
                li.className = 'insight-item';
                li.textContent = point;
                ul.appendChild(li);
            });
            pointsGroup.appendChild(ul);
            reportBody.appendChild(pointsGroup);
        }

        // Section 6: Decisions Made (If any)
        if (report.decisions_made && report.decisions_made.length > 0) {
            const decisionsGroup = createReportGroup("Decisions Agreed", "🤝");
            const ul = document.createElement('ul');
            ul.className = 'insights-list';
            report.decisions_made.forEach(decision => {
                const li = document.createElement('li');
                li.className = 'insight-item';
                li.textContent = decision;
                ul.appendChild(li);
            });
            decisionsGroup.appendChild(ul);
            reportBody.appendChild(decisionsGroup);
        }

        // Section 7: Commitments (If any)
        if (report.commitments && report.commitments.length > 0) {
            const commitGroup = createReportGroup("Commitments Made", "📌");
            const ul = document.createElement('ul');
            ul.className = 'insights-list';
            report.commitments.forEach(item => {
                const li = document.createElement('li');
                li.className = 'insight-item';
                li.innerHTML = `<strong>${item.by}:</strong> ${item.commitment}`;
                ul.appendChild(li);
            });
            commitGroup.appendChild(ul);
            reportBody.appendChild(commitGroup);
        }

        // Section 8: Questions Raised (If any)
        if (report.questions_raised && report.questions_raised.length > 0) {
            const questionsGroup = createReportGroup("Unresolved Questions", "❓");
            const ul = document.createElement('ul');
            ul.className = 'insights-list';
            report.questions_raised.forEach(q => {
                const li = document.createElement('li');
                li.className = 'insight-item';
                li.textContent = q;
                ul.appendChild(li);
            });
            questionsGroup.appendChild(ul);
            reportBody.appendChild(questionsGroup);
        }

        // Section 9: Action Items (If any)
        if (report.action_items && report.action_items.length > 0) {
            const actionsGroup = createReportGroup("Action Items Checklist", "⚡");
            const container = document.createElement('div');
            container.className = 'action-items-list';
            
            report.action_items.forEach(item => {
                const itemCard = document.createElement('div');
                itemCard.className = 'action-item-card';
                
                const urgencyClass = item.urgency ? item.urgency.toLowerCase() : 'whenever';
                
                itemCard.innerHTML = `
                    <div class="action-item-main">
                        <div class="action-item-text">${item.action}</div>
                        <div class="action-item-owner">Owner: ${item.owner || 'Both'}</div>
                    </div>
                    <span class="action-urgency ${urgencyClass}">${item.urgency || 'Whenever'}</span>
                `;
                container.appendChild(itemCard);
            });
            
            actionsGroup.appendChild(container);
            reportBody.appendChild(actionsGroup);
        }

        // Section 10: Topics Mentioned
        if (report.topics_mentioned && report.topics_mentioned.length > 0) {
            const topicsGroup = createReportGroup("Topics & Entities", "🏷️");
            const cloud = document.createElement('div');
            cloud.className = 'tag-cloud';
            report.topics_mentioned.forEach(topic => {
                const tag = document.createElement('span');
                tag.className = 'tag';
                tag.textContent = topic;
                cloud.appendChild(tag);
            });
            topicsGroup.appendChild(cloud);
            reportBody.appendChild(topicsGroup);
        }

        // Section 11: Original Language Notes (If any)
        if (report.original_language_notes) {
            const notesGroup = createReportGroup("Original Language & Idioms", "🗣️");
            const noteCard = document.createElement('div');
            noteCard.className = 'summary-card';
            noteCard.style.borderLeft = '3px solid var(--accent)';
            noteCard.textContent = report.original_language_notes;
            notesGroup.appendChild(noteCard);
            reportBody.appendChild(notesGroup);
        }
    }

    function createReportGroup(titleText, emoji) {
        const group = document.createElement('div');
        group.className = 'report-group';
        
        const title = document.createElement('h3');
        title.className = 'report-group-title';
        title.innerHTML = `<span>${emoji}</span> ${titleText}`;
        
        group.appendChild(title);
        return group;
    }

    function getToneColor(tone) {
        if (!tone) return 'var(--text-primary)';
        const t = tone.toLowerCase();
        if (t.includes('positive') || t.includes('productive')) return 'var(--secondary)';
        if (t.includes('tense') || t.includes('frustrated')) return 'var(--danger)';
        if (t.includes('neutral') || t.includes('inconclusive')) return 'var(--accent)';
        return 'var(--text-primary)';
    }

    function getMoodColor(mood) {
        if (!mood) return 'var(--text-primary)';
        const m = mood.toLowerCase();
        if (m.includes('calm') || m.includes('professional')) return 'var(--secondary)';
        if (m.includes('excited')) return '#38bdf8'; // Sky blue
        if (m.includes('frustrated') || m.includes('aggressive')) return 'var(--danger)';
        if (m.includes('confused')) return 'var(--accent)';
        return 'var(--text-primary)';
    }

    // Copy Handlers
    copyTranscriptBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(transcriptText.textContent).then(() => {
            const originalText = copyTranscriptBtn.innerHTML;
            copyTranscriptBtn.innerHTML = `
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
                Copied!
            `;
            setTimeout(() => {
                copyTranscriptBtn.innerHTML = originalText;
            }, 2000);
        });
    });

    copyReportBtn.addEventListener('click', () => {
        if (!fullReportJson) return;
        const jsonStr = JSON.stringify(fullReportJson, null, 2);
        navigator.clipboard.writeText(jsonStr).then(() => {
            const originalText = copyReportBtn.innerHTML;
            copyReportBtn.innerHTML = `
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
                Copied JSON!
            `;
            setTimeout(() => {
                copyReportBtn.innerHTML = originalText;
            }, 2000);
        });
    });
});
