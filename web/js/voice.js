/**
 * 语音练习控制器：
 * - 你的说话：浏览器 Web Speech API（按键说话，可停）
 * - 受试者旁白：后端 MiniMax TTS（可暂停）
 * - 旁白播放时自动关麦，避免拾取扬声器声音
 * - 停止说话后等待 onend/短延时，确保末段识别结果写入输入框
 */

export function createVoiceController({ onFinalTranscript, onTranscriptUpdate, onStatus }) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let enabled = false;
  let listening = false;
  let speaking = false;
  let processing = false;
  let recognition = null;
  let currentAudio = null;
  let abortSpeak = false;
  let interim = '';
  let configured = false;
  let finalBuffer = '';
  let wantListen = false;
  let pendingCommit = false;
  let commitTimer = null;

  function combinedText() {
    return `${finalBuffer} ${interim}`.trim();
  }

  function emit(extra = {}) {
    onStatus?.({
      enabled,
      listening,
      speaking,
      processing,
      configured,
      speechRecognition: !!SpeechRecognition,
      interim,
      draft: finalBuffer,
      ...extra,
    });
  }

  function notifyTranscript({ finalize = false } = {}) {
    onTranscriptUpdate?.({
      text: combinedText(),
      listening,
      finalize,
      processing,
    });
  }

  function clearCommitTimer() {
    if (commitTimer) {
      clearTimeout(commitTimer);
      commitTimer = null;
    }
  }

  function finishCommit() {
    if (!pendingCommit) return;
    pendingCommit = false;
    processing = false;
    clearCommitTimer();
    const text = combinedText();
    notifyTranscript({ finalize: true });
    if (text) {
      onFinalTranscript?.(text);
    }
    finalBuffer = '';
    interim = '';
    emit();
  }

  function stopPlayback() {
    abortSpeak = true;
    speaking = false;
    if (currentAudio) {
      try {
        currentAudio.pause();
        currentAudio.src = '';
      } catch {
        /* ignore */
      }
      currentAudio = null;
    }
    emit({ speaking: false });
  }

  async function refreshStatus() {
    try {
      const res = await fetch('/api/voice/status');
      const data = await res.json();
      configured = !!data.configured;
      emit({
        model: data.model,
        voiceId: data.voice_id,
      });
      return data;
    } catch {
      configured = false;
      emit({ configured: false });
      return null;
    }
  }

  function ensureRecognition() {
    if (!SpeechRecognition) return null;
    if (recognition) return recognition;
    recognition = new SpeechRecognition();
    recognition.lang = 'zh-CN';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      listening = true;
      processing = false;
      pendingCommit = false;
      clearCommitTimer();
      emit();
    };

    recognition.onspeechstart = () => {
      if (speaking) stopPlayback();
    };

    recognition.onresult = (event) => {
      let finalChunk = '';
      interim = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const r = event.results[i];
        const text = (r[0]?.transcript || '').trim();
        if (!text) continue;
        if (r.isFinal) finalChunk += `${text} `;
        else interim = text;
      }
      finalChunk = finalChunk.trim();
      if (finalChunk) {
        finalBuffer = `${finalBuffer} ${finalChunk}`.trim();
        interim = '';
      }
      notifyTranscript({ finalize: false });
      emit();
    };

    recognition.onerror = (e) => {
      if (e.error === 'not-allowed') {
        enabled = false;
        wantListen = false;
        listening = false;
        pendingCommit = false;
        processing = false;
        clearCommitTimer();
        emit({ error: '麦克风权限被拒绝' });
        return;
      }
      if (pendingCommit && e.error === 'aborted') {
        return;
      }
      if (wantListen && enabled && !speaking && e.error !== 'aborted') {
        setTimeout(() => startListeningInternal(), 400);
      }
    };

    recognition.onend = () => {
      listening = false;
      emit();
      if (pendingCommit) {
        // 浏览器常在 stop() 之后才抛出末段 final 结果，此处统一收口
        setTimeout(() => finishCommit(), 80);
        return;
      }
      if (wantListen && enabled && !speaking) {
        setTimeout(() => startListeningInternal(), 200);
      }
    };

    return recognition;
  }

  function startListeningInternal() {
    if (!enabled || !wantListen || speaking || pendingCommit) return;
    const rec = ensureRecognition();
    if (!rec || listening) return;
    try {
      rec.start();
    } catch {
      /* already started */
    }
  }

  function startListening() {
    if (!enabled) return false;
    if (!SpeechRecognition) {
      emit({ error: '当前浏览器不支持语音识别，请用 Chrome/Edge' });
      return false;
    }
    if (processing) return false;
    wantListen = true;
    pendingCommit = false;
    clearCommitTimer();
    finalBuffer = '';
    interim = '';
    startListeningInternal();
    notifyTranscript({ finalize: false });
    emit();
    return true;
  }

  function stopListening({ commit = true } = {}) {
    wantListen = false;
    if (!recognition) {
      listening = false;
      processing = false;
      const draft = combinedText();
      if (commit && draft) {
        notifyTranscript({ finalize: true });
        onFinalTranscript?.(draft);
        finalBuffer = '';
        interim = '';
      }
      emit();
      return draft;
    }

    const snapshot = combinedText();
    if (commit) {
      pendingCommit = true;
      processing = true;
      // 先把已有内容实时写入，避免用户以为没录上
      if (snapshot) notifyTranscript({ finalize: false });
      emit({ processing: true });
    }

    try {
      recognition.stop();
    } catch {
      /* ignore */
    }

    if (!commit) {
      listening = false;
      pendingCommit = false;
      processing = false;
      finalBuffer = '';
      interim = '';
      emit();
      return snapshot;
    }

    // 若 onend 迟迟不来，兜底提交
    clearCommitTimer();
    commitTimer = setTimeout(() => finishCommit(), 650);

    return snapshot;
  }

  async function setEnabled(next) {
    enabled = !!next;
    if (!enabled) {
      wantListen = false;
      pendingCommit = false;
      processing = false;
      clearCommitTimer();
      stopListening({ commit: false });
      stopPlayback();
      finalBuffer = '';
      interim = '';
      emit({ listening: false, speaking: false, processing: false });
      return;
    }
    await refreshStatus();
    if (!SpeechRecognition) {
      emit({
        error: '当前浏览器不支持语音识别，请用 Chrome/Edge',
        speechRecognition: false,
      });
      return;
    }
    emit();
  }

  async function speak(text) {
    if (!enabled || !text) return false;
    const wasWant = wantListen;
    wantListen = false;
    pendingCommit = false;
    processing = false;
    clearCommitTimer();
    if (listening) {
      try {
        recognition?.stop();
      } catch {
        /* ignore */
      }
      listening = false;
    }

    abortSpeak = false;
    stopPlayback();
    abortSpeak = false;
    speaking = true;
    emit({ speaking: true, listening: false, processing: false });

    try {
      const res = await fetch('/api/voice/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        speaking = false;
        emit({
          speaking: false,
          error: data.detail || data.error || '旁白合成失败',
        });
        if (wasWant) {
          wantListen = true;
          startListeningInternal();
        }
        return false;
      }
      if (abortSpeak) {
        speaking = false;
        emit({ speaking: false });
        return false;
      }

      const bin = atob(data.audio_base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: 'audio/mpeg' });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      currentAudio = audio;

      await new Promise((resolve) => {
        audio.onended = () => {
          URL.revokeObjectURL(url);
          if (currentAudio === audio) currentAudio = null;
          resolve();
        };
        audio.onerror = () => {
          URL.revokeObjectURL(url);
          if (currentAudio === audio) currentAudio = null;
          resolve();
        };
        audio.play().catch(() => resolve());
      });

      speaking = false;
      emit({ speaking: false });
      return !abortSpeak;
    } catch (err) {
      speaking = false;
      emit({
        speaking: false,
        error: String(err.message || err),
      });
      return false;
    }
  }

  return {
    refreshStatus,
    setEnabled,
    speak,
    stopPlayback,
    startListening,
    stopListening,
    isEnabled: () => enabled,
    isListening: () => listening,
    isSpeaking: () => speaking,
  };
}
