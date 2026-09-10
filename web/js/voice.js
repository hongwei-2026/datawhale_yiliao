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
  let talkingHeadEnabled = false;
  let musetalkEnabled = false;
  let finalBuffer = '';
  let wantListen = false;
  let pendingCommit = false;
  let commitTimer = null;
  /** 仅在为 true 时，学员说话才会截断受试者旁白（默认关，避免环境噪声误触） */
  let bargeInEnabled = false;

  function setBargeInEnabled(on) {
    bargeInEnabled = !!on;
  }

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
        if (currentAudio.pause) currentAudio.pause();
        if (currentAudio.tagName === 'VIDEO') {
          currentAudio.removeAttribute('src');
          currentAudio.load?.();
        } else {
          currentAudio.src = '';
        }
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
      talkingHeadEnabled = !!data.talking_head?.enabled;
      musetalkEnabled = !!(data.musetalk?.enabled && data.musetalk?.ready);
      emit({
        model: data.model,
        voiceId: data.voice_id,
        talkingHeadEnabled,
        musetalkEnabled,
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
      if (speaking && bargeInEnabled) stopPlayback();
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
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        enabled = false;
        wantListen = false;
        listening = false;
        pendingCommit = false;
        processing = false;
        clearCommitTimer();
        emit({ error: '麦克风权限被拒绝：请在浏览器地址栏允许麦克风后，再打开「语音模式」' });
        return;
      }
      if (e.error === 'audio-capture') {
        enabled = false;
        wantListen = false;
        listening = false;
        pendingCommit = false;
        processing = false;
        clearCommitTimer();
        emit({ error: '未检测到麦克风，请检查系统输入设备' });
        return;
      }
      if (pendingCommit && e.error === 'aborted') {
        return;
      }
      if (e.error === 'no-speech') {
        emit({ error: '没听清，请靠近麦克风再说一次' });
        if (wantListen && enabled && !speaking) {
          setTimeout(() => startListeningInternal(), 400);
        }
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

  async function pollVideoJob(jobId, { onTick, signal, intervalMs = 3000 } = {}) {
    const deadline = Date.now() + 200000;
    while (Date.now() < deadline) {
      if (signal?.aborted) return null;
      await new Promise((r) => setTimeout(r, intervalMs));
      if (signal?.aborted) return null;
      try {
        const res = await fetch(`/api/voice/patient-speak/video/${jobId}`);
        const job = await res.json();
        onTick?.(job);
        if (job.status === 'succeeded' && job.video_url) return job.video_url;
        if (job.status === 'failed') {
          emit({ talkingHeadError: job.error || '口型视频生成失败' });
          return null;
        }
      } catch {
        /* retry */
      }
    }
    emit({ talkingHeadError: '口型视频生成超时' });
    return null;
  }

  async function fetchPatientSpeak(text, personaId, emotion, prosody = {}) {
    const res = await fetch('/api/voice/patient-speak', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        persona_id: personaId || '',
        emotion: emotion || '',
        prefer_talking_video: musetalkEnabled || talkingHeadEnabled,
        stance: prosody.stance || '',
        speed: prosody.speed ?? null,
        vol: prosody.vol ?? null,
        pitch: prosody.pitch ?? null,
        pause_sec: prosody.pause_sec ?? null,
        comma_pause_sec: prosody.comma_pause_sec ?? null,
      }),
    });
    if (res.status === 404) {
      const ttsRes = await fetch('/api/voice/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const ttsData = await ttsRes.json();
      if (!ttsRes.ok || !ttsData.ok) {
        throw new Error(ttsData.detail || ttsData.error || '旁白合成失败（请重启后端服务）');
      }
      return { ...ttsData, mode: 'audio_only', talking_head_error: '后端未加载说话数字人接口，请重启 uvicorn' };
    }
    let data;
    try {
      data = await res.json();
    } catch {
      throw new Error(`旁白接口异常 HTTP ${res.status}`);
    }
    if (!res.ok || !data.ok) {
      const msg = data.detail || data.error || '旁白合成失败';
      if (data.soft || /insufficient|balance|余额|quota/i.test(String(msg))) {
        emit({ talkingHeadError: msg });
        const err = new Error(msg);
        err.soft = true;
        throw err;
      }
      if (res.status === 400 || res.status === 503) {
        throw new Error(msg.includes('未配置') ? `${msg}（可在无语音模式下继续文字对话）` : msg);
      }
      throw new Error(msg);
    }
    return data;
  }

  async function playAudioBase64(audioBase64, hooks = {}) {
    const { onAudio } = hooks;
    const bin = atob(audioBase64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes], { type: 'audio/mpeg' });
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    currentAudio = audio;
    onAudio?.(audio);
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
  }

  async function speakPatientNarration(text, hooks = {}) {
    const {
      onAudio, onEnd, onGenerating, onVideo, personaId, emotion,
      stance, speed, vol, pitch, pause_sec, comma_pause_sec, prosodyLabel,
    } = hooks;
    if (!text) return false;

    const wasWant = wantListen;
    wantListen = false;
    pendingCommit = false;
    processing = false;
    clearCommitTimer();
    if (listening) {
      try { recognition?.stop(); } catch { /* ignore */ }
      listening = false;
    }

    abortSpeak = false;
    stopPlayback();
    abortSpeak = false;
    speaking = true;
    emit({ speaking: true, listening: false, processing: false });

    const abortCtl = { aborted: false };
    const signal = {
      get aborted() { return abortSpeak || abortCtl.aborted; },
    };

    try {
      onGenerating?.({
        status: 'tts',
        message: prosodyLabel ? `正在合成语音（${prosodyLabel}）…` : '正在合成语音…',
      });
      const data = await fetchPatientSpeak(text, personaId, emotion, {
        stance, speed, vol, pitch, pause_sec, comma_pause_sec,
      });
      if (abortSpeak) {
        speaking = false;
        emit({ speaking: false });
        onEnd?.();
        return false;
      }

      if (data.mode === 'talking_video' && data.video_url) {
        onGenerating?.({
          status: 'video',
          message: data.cache_hit ? '播放口型视频…' : '口型视频就绪…',
        });
        const playPromise = onVideo?.(data.video_url);
        if (playPromise && typeof playPromise.then === 'function') await playPromise;
        speaking = false;
        emit({ speaking: false });
        onEnd?.();
        if (wasWant && enabled) { wantListen = true; startListeningInternal(); }
        return !abortSpeak;
      }

      const musetalkJob = data.mode === 'musetalk_video_job' && data.video_job_id;
      if (musetalkJob) {
        onGenerating?.({ status: 'video', message: 'GPU 生成口型视频（音画合一）…' });
        const videoUrl = await pollVideoJob(data.video_job_id, {
          signal,
          intervalMs: 1500,
          onTick: (job) => {
            if (job.status === 'running') {
              onGenerating?.({ status: 'video', message: 'GPU 生成口型视频…' });
            }
          },
        });
        if (videoUrl && !abortSpeak) {
          const playPromise = onVideo?.(videoUrl);
          if (playPromise && typeof playPromise.then === 'function') await playPromise;
          speaking = false;
          emit({ speaking: false });
          onEnd?.();
          if (wasWant && enabled) { wantListen = true; startListeningInternal(); }
          return !abortSpeak;
        }
        onGenerating?.({ status: 'tts', message: '口型生成失败，仅播放语音…' });
      }

      let videoPromise = null;
      if (data.mode === 'audio_with_video_job' && data.video_job_id) {
        onGenerating?.({ status: 'video', message: '口型视频生成中（MiniMax H3，约 30–90 秒）…' });
        videoPromise = pollVideoJob(data.video_job_id, {
          signal,
          onTick: (job) => {
            if (job.status === 'running') {
              onGenerating?.({ status: 'video', message: '口型视频生成中（MiniMax H3）…' });
            }
          },
        });
      }

      if (data.audio_base64) {
        await playAudioBase64(data.audio_base64, { onAudio });
      }
      if (data.talking_head_error) {
        emit({ talkingHeadError: data.talking_head_error });
      }

      if (videoPromise && !abortSpeak) {
        const videoUrl = await videoPromise;
        if (videoUrl && !abortSpeak) {
          stopPlayback();
          speaking = true;
          emit({ speaking: true });
          onGenerating?.({ status: 'video', message: '播放说话画面…' });
          const playPromise = onVideo?.(videoUrl);
          if (playPromise && typeof playPromise.then === 'function') await playPromise;
        }
      }

      speaking = false;
      emit({ speaking: false });
      onEnd?.();
      if (wasWant && enabled) {
        wantListen = true;
        startListeningInternal();
      }
      return !abortSpeak;
    } catch (err) {
      speaking = false;
      emit({ speaking: false, error: String(err.message || err) });
      onEnd?.();
      return false;
    }
  }

  async function speak(text) {
    if (!enabled || !text) return false;
    return speakPatientNarration(text);
  }

  return {
    refreshStatus,
    setEnabled,
    setBargeInEnabled,
    speak,
    speakPatientNarration,
    stopPlayback,
    startListening,
    stopListening,
    isEnabled: () => enabled,
    isListening: () => listening,
    isSpeaking: () => speaking,
  };
}
