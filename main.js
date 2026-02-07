const SECRET_PART_1 = "AIzaSy";

const SECRET_PART_2 = "B1qmLvsgWw";

const SECRET_PART_3 = "2mjsFqjLMDDvWOtmhxtnGDM";
// 把它組起來  不要亂動這行 然後tm誰敢拿上面api我跟你拼命
const GEMINI_API_KEY = (SECRET_PART_1 + SECRET_PART_2 + SECRET_PART_3).trim();
// =======================================================

const AI_MODEL = "gemini-2.0-flash";
let currentTemp = "--", currentHumi = "--", currentAir = "--", currentDist = "--", currentRain = "--";
let historyData = [], port, reader, writer, isHardwareConnected = false, chart;
let userLat = null, userLon = null;
let dataSource = "GFS";
let recognition, isVoiceOutputOn = true, synth = window.speechSynthesis;
let ytPlayer, map, mapMarker;
let musicPlaylist = []; let currentPlayIndex = 0;

// 直接回傳就好 不用那些有的沒的檢查了
function getApiKey() {
    return GEMINI_API_KEY;
}
// ====================================================

function requestGPS() {
    const bootText = document.getElementById('boot-text');
    bootText.innerHTML = "正在連線衛星 (GPS)...<br><span style='font-size:0.8rem; color:#888'>請允許瀏覽器存取位置</span>";
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                userLat = position.coords.latitude; userLon = position.coords.longitude;
                bootText.innerHTML = `GPS 鎖定完成<br>LAT: ${userLat.toFixed(4)} LON: ${userLon.toFixed(4)}<br><br>正在載入系統...`;
                setTimeout(startSystem, 1000);
            },
            (error) => {
                bootText.innerHTML = "GPS 訊號遺失。<br>請檢查瀏覽器權限或網路。<br><button class='btn' onclick='startSystem()'>強制啟動</button>";
                userLat = 25.0330; userLon = 121.5654;
            }
        );
    } else { alert("不支援 GPS"); startSystem(); }
}

function startSystem() {
    document.getElementById('boot-screen').style.display = 'none';
    initChart(); initMap(); initSpeechRecognition(); initYouTubeAPI();
    manualSyncOnline();
    setInterval(updateSimData, 1000);
    speak("系統已啟動。");
    // checkApiKey(); // 不需要檢查 因為已經硬編碼 你要的話我沒意見
}

function updateSimData() {
    if (!isHardwareConnected) {
        let t = currentTemp; let h = currentHumi;
        if (t === "--") t = 25.0; if (h === "--") h = 60.0;
        t = (parseFloat(t) + (Math.random() * 0.2 - 0.1)).toFixed(1);
        h = (parseFloat(h) + (Math.random() * 1 - 0.5)).toFixed(0);
        updateUI(t, h, currentAir, currentRain, 0, false);
    }

    // 自動校時：只有硬體有接上才送 不然沒意義
    if (isHardwareConnected && writer) {
        const d = new Date();
        const mm = (d.getMonth() + 1).toString().padStart(2, '0');
        const dd = d.getDate().toString().padStart(2, '0');
        const hh = d.getHours().toString().padStart(2, '0');
        const min = d.getMinutes().toString().padStart(2, '0');
        // 指令格式: TIME:MM/DD,HH:mm 重要的:)
        const timeCmd = `TIME:${mm}/${dd},${hh}:${min}`;
        sendCmd(timeCmd);
    }
}

function parseHW(json) {
    try {
        const d = JSON.parse(json);
        if (d.t !== undefined) updateUI(d.t, d.h, currentAir, currentRain, d.d, true);

        if (d.event) {
            writeLog("硬體事件: " + d.event);
            if (d.event === "btn_ptt") {
                const micBtn = document.getElementById('btn-mic');
                if (!document.getElementById('view-ai').classList.contains('active')) {
                    switchView('ai'); setTimeout(() => startListening(), 300);
                } else {
                    if (micBtn.classList.contains('listening')) stopListening(); else startListening();
                }
            }
        }
    } catch (e) { }
}

function updateUI(t, h, a, r, d, isFromHardware) {
    if (isFromHardware) {
        currentTemp = t; currentHumi = h; currentAir = a; currentDist = d;
        setTag('temp', 'SENSOR', 'sensor'); setTag('humi', 'SENSOR', 'sensor'); setTag('air', 'SENSOR (MQ)', 'sensor');
    } else {
        if (!isHardwareConnected) {
            currentTemp = t; currentHumi = h; currentAir = a;
            if (t == 25.0) { setTag('temp', 'SCANNING', 'sensor'); setTag('humi', 'SCANNING', 'sensor'); }
            else { setTag('temp', 'CLOUD', 'cloud'); setTag('humi', 'CLOUD', 'cloud'); }
        }
    }
    if (r !== undefined) currentRain = r;
    setTag('rain', 'CLOUD', 'cloud');

    document.getElementById('val-temp').innerText = currentTemp;
    document.getElementById('val-humi').innerText = currentHumi;
    document.getElementById('val-air').innerText = currentAir;
    document.getElementById('val-rain').innerText = currentRain;

    const now = new Date().toLocaleTimeString();
    if (chart && chart.data) {
        if (chart.data.labels.length > 20) { chart.data.labels.shift(); chart.data.datasets.forEach(x => x.data.shift()); }
        chart.data.labels.push(now);
        chart.data.datasets[0].data.push(currentTemp === "--" ? 0 : currentTemp);
        chart.data.datasets[1].data.push(currentHumi === "--" ? 0 : currentHumi);
        chart.data.datasets[2].data.push(currentRain === "--" ? 0 : currentRain);
        chart.update('none');
    }
    historyData.push({ time: now, t: currentTemp, h: currentHumi, a: currentAir, r: currentRain, d: currentDist });
}

async function manualSyncOnline() {
    if (!userLat || !userLon) return;
    writeLog(`連線氣象衛星 (${dataSource})...`);
    document.getElementById('tag-rain').innerText = "SYNCING...";
    try {
        let modelParam = (dataSource === "JMA") ? "&models=jma_seamless" : "&models=gfs_seamless";
        const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${userLat}&longitude=${userLon}&current=temperature_2m,relative_humidity_2m&hourly=precipitation_probability&timezone=auto${modelParam}`;
        const airUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${userLat}&longitude=${userLon}&current=us_aqi`;
        const [resW, resA] = await Promise.all([fetch(weatherUrl), fetch(airUrl)]);
        const dW = await resW.json(); const dA = await resA.json();
        const rainProb = dW.hourly.precipitation_probability[new Date().getHours()];
        const aqi = dA.current ? dA.current.us_aqi : "--";
        currentRain = rainProb;

        if (isHardwareConnected && writer) {
            sendCmd("aqi:" + aqi);
        }

        updateUI(dW.current.temperature_2m, dW.current.relative_humidity_2m, aqi, rainProb, 0, false);
        writeLog(`同步: Rain ${rainProb}% / AQI ${aqi}`);
    } catch (e) {
        writeLog("連線失敗: " + e.message);
        document.getElementById('tag-rain').innerText = "OFFLINE";
    }
}

function setTag(id, text, type) { const el = document.getElementById('tag-' + id); if (el) { el.innerText = text; el.className = "source-tag " + type; } }
function downloadCSV() {
    if (historyData.length === 0) { alert("無數據"); return; }
    let csvContent = "\uFEFF時間,溫度,濕度,AQI,降雨機率,距離\n";
    historyData.forEach(row => { csvContent += `${row.time},${row.t},${row.h},${row.a},${row.r},${row.d}\n`; });
    const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([csvContent], { type: 'text/csv;charset=utf-8;' }));
    link.download = "TACTICAL_REPORT_" + Date.now() + ".csv"; link.click();
}
function toggleSource() { dataSource = (dataSource === "GFS") ? "JMA" : "GFS"; document.getElementById('source-display').innerText = "SOURCE: " + dataSource; manualSyncOnline(); }
function initMap() {
    if (!userLat) { userLat = 25.0330; userLon = 121.5654; }
    map = L.map('map', { zoomControl: false, attributionControl: false }).setView([userLat, userLon], 14);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 19 }).addTo(map);
    mapMarker = L.circleMarker([userLat, userLon], { color: '#10b981', fillColor: '#10b981', fillOpacity: 0.5, radius: 8 }).addTo(map);
    mapMarker.bindPopup("<b>OP: CURRENT LOCATION</b>").openPopup();
}
async function connectSerial() {
    try {
        port = await navigator.serial.requestPort(); await port.open({ baudRate: 9600 });
        const dec = new TextDecoderStream(); port.readable.pipeTo(dec.writable); reader = dec.readable.getReader();
        const enc = new TextEncoderStream(); enc.readable.pipeTo(port.writable); writer = enc.writable.getWriter();
        isHardwareConnected = true;
        document.getElementById('conn-dot').classList.add('online'); document.getElementById('conn-text').innerText = "硬體連線"; document.getElementById('conn-text').style.color = "#10b981";
        writeLog("硬體連線成功！"); readLoop();
    } catch (e) { alert("連線失敗"); }
}
async function readLoop() { let buf = ""; while (true) { const { value, done } = await reader.read(); if (done) break; buf += value; let lines = buf.split('\n'); buf = lines.pop(); for (let l of lines) parseHW(l.trim()); } }
async function sendCmd(cmd) { if (writer) await writer.write(cmd + "\n"); }

// 啟動 YouTube API (解決載入順序問題)
function initYouTubeAPI() {
    const tag = document.createElement('script');
    tag.src = "https://www.youtube.com/iframe_api";
    const firstScriptTag = document.getElementsByTagName('script')[0];
    firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
}

// 這裡要設為 global function，不然 API 找不到
window.onYouTubeIframeAPIReady = function () {
    console.log("YouTube API Ready");
    const currentOrigin = window.location.origin;
    ytPlayer = new YT.Player('yt-player', {
        height: '100%',
        width: '100%',
        videoId: '',
        playerVars: {
            'playsinline': 1,
            'controls': 1,
            'origin': currentOrigin,
            'autoplay': 1, // 試著自動播放
            'rel': 0       // 播完不要推薦亂七八糟的
        },
        events: { 'onStateChange': onPlayerStateChange, 'onError': onPlayerError }
    });
};

// 系統啟動時順便載入 API
// ================= Music =================
// function onYouTubeIframeAPIReady() { ... } // 舊的拿掉
function onPlayerError(e) {
    writeLog(`YouTube 錯誤 [${e.data}]`);
    document.getElementById('track-name').innerText = "播放錯誤 (版權/限制) -> 跳下一首";
    document.getElementById('track-name').style.color = "#ff4444";
    // 遇到錯誤直接跳下一首，不要讓使用者乾等
    setTimeout(() => nextTrack(), 1500);
}
function onPlayerStateChange(e) {
    const viz = document.getElementById('viz-bars'); const t = document.getElementById('track-name');
    if (e.data == YT.PlayerState.PLAYING) { viz.classList.add('playing'); t.style.color = "#fff"; }
    else { viz.classList.remove('playing'); t.style.color = "var(--accent)"; }
    if (e.data === 0) nextTrack();
}
async function searchMusic() {
    const q = document.getElementById('music-query').value; if (!q) return;
    const apiKey = getApiKey();

    document.getElementById('track-name').innerText = "搜尋中...";
    // 加了 videoEmbeddable=true 才不會搜到那些不能播的爛東西
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&maxResults=20&q=${encodeURIComponent(q)}&type=video&videoEmbeddable=true&key=${apiKey}`;
    try {
        const res = await fetch(url); const data = await res.json();
        if (data.error) { alert("API 錯誤：" + data.error.message); return; }
        if (data.items && data.items.length > 0) {
            musicPlaylist = data.items; currentPlayIndex = 0; loadTrack(currentPlayIndex);
            writeLog("清單建立: " + data.items.length + " 首");
        } else alert("無結果");
    } catch (e) { alert("API 連線錯誤: " + e.message); }
}
function loadTrack(index) {
    if (index < 0 || index >= musicPlaylist.length) return;
    const item = musicPlaylist[index];
    document.getElementById('track-name').innerText = `PLAYING [${index + 1}/${musicPlaylist.length}]: ${item.snippet.title}`;

    if (ytPlayer && ytPlayer.loadVideoById) {
        ytPlayer.loadVideoById(item.id.videoId);
    } else {
        console.error("Player not ready");
        writeLog("錯誤: 播放器尚未就緒，請稍後再試");
    }
}
function nextTrack() {
    if (musicPlaylist.length === 0) return;
    currentPlayIndex = (currentPlayIndex + 1) % musicPlaylist.length;
    loadTrack(currentPlayIndex);
}
function testPlay() { if (ytPlayer && ytPlayer.loadVideoById) ytPlayer.loadVideoById("jfKfPfyJRdk"); }
function initSpeechRecognition() {
    if ('webkitSpeechRecognition' in window) {
        recognition = new webkitSpeechRecognition(); recognition.lang = 'zh-TW';
        recognition.onstart = () => document.getElementById('btn-mic').classList.add('listening');
        recognition.onend = () => document.getElementById('btn-mic').classList.remove('listening');
        recognition.onresult = (e) => { document.getElementById('user-input').value = e.results[0][0].transcript; askJarvis(); };
    }
}
function startListening() { if (recognition) recognition.start(); }
function stopListening() { if (recognition) recognition.stop(); }
function toggleVoiceOutput() { isVoiceOutputOn = !isVoiceOutputOn; document.getElementById('voice-toggle').innerText = isVoiceOutputOn ? "語音: 開" : "語音: 關"; }
// 改用 Google 小姐 (Google Translate TTS)
let voices = [];
function loadVoices() {
    voices = synth.getVoices();
}
if (speechSynthesis.onvoiceschanged !== undefined) {
    speechSynthesis.onvoiceschanged = loadVoices;
}

function speak(text) {
    if (isVoiceOutputOn) {
        // 確保有聲音列表
        if (voices.length === 0) loadVoices();

        const u = new SpeechSynthesisUtterance(text.replace(/[*#]/g, ''));
        const targetLang = detectLanguage(text);
        u.lang = targetLang;

        // 嘗試挑選高品質的 Google 語音
        const googleVoice = voices.find(v => v.lang.includes(targetLang) && v.name.includes('Google'));
        const normalVoice = voices.find(v => v.lang.includes(targetLang));

        if (googleVoice) {
            u.voice = googleVoice;
            console.log("Using Google Voice:", googleVoice.name);
        } else if (normalVoice) {
            u.voice = normalVoice;
            console.log("Using Normal Voice:", normalVoice.name);
        }

        // 微調一下參數讓它聽起來自然點
        u.rate = 1.0;
        u.pitch = 1.0;

        synth.speak(u);
    }
}

function detectLanguage(text) {
    if (/[\u3040-\u30ff\u31f0-\u31ff]/.test(text)) return 'ja-JP';
    if (/[\uac00-\ud7af]/.test(text)) return 'ko-KR';
    if (/[\u4e00-\u9fff]/.test(text)) return 'zh-TW';
    return 'en-US';
}
// ================= Jarvis 核心邏輯 =================
// 這裡用來存對話紀錄 不然 Jarvis 會變金魚腦 跟智障一樣
let conversationHistory = [];
const MAX_HISTORY = 10; // 記太多會爆 Token 留最後 10 句就好 免費token 沒辦法

async function askJarvis() {
    const input = document.getElementById('user-input'); const display = document.getElementById('chat-box');
    const q = input.value.trim(); if (!q) return;
    const apiKey = getApiKey();

    // 1. 把使用者的話丟到畫面上
    display.innerHTML += `<div class="user-msg">${q.replace(/</g, "&lt;")}</div>`;
    input.value = ""; display.scrollTop = display.scrollHeight;

    // 2. 偷懶用前端攔截指令 不用每次都問 API
    if (q.match(/^(clear|cls|清除)$/i)) {
        display.innerHTML = '<div class="ai-msg">好，對話紀錄清空了。</div>';
        conversationHistory = [];
        return;
    }

    // 3. 假裝自己在思考的特效 (其實是轉圈圈)
    const thinkingId = 'thinking-' + Date.now();
    display.innerHTML += `<div id="${thinkingId}" class="ai-msg thinking"><i class="fas fa-circle-notch"></i> 思考中...</div>`;
    display.scrollTop = display.scrollHeight;

    // 4. 這是給 Jarvis 的人設 叫他講話像個軍人 我也不知道為啥要像軍人   崊杯爽
    const systemPrompt = `
    ROLE: You are JARVIS, a Tactical AI for the A.I.O.T. OS.
    LOCATION: Lat ${userLat?.toFixed(4) || 'Unknown'}, Lon ${userLon?.toFixed(4) || 'Unknown'}
    STATUS: Temp ${currentTemp}°C, Humi ${currentHumi}%, Rain ${currentRain}%, AQI ${currentAir}
    
    COMMANDS (You can execute these by outputting the EXACT format at the end of response):
    - [CMD:SWITCH:viewId] -> Switch tabs (dashboard, ai, music, system)
    - [CMD:PLAY:songName] -> Search & Play music (e.g., [CMD:PLAY:Lo-Fi])
    - [CMD:SAY:text] -> Force TTS output
    
    RULES:
    - **LANGUAGE**: 
      - If user speaks **Chinese** (Simplified/Traditional), YOU MUST REPLY IN **TRADITIONAL CHINESE (繁體中文)**.
      - If user speaks **ANY OTHER LANGUAGE** (English, Japanese, Korean...), reply in that **SAME LANGUAGE**.
    - **PERSONA**: Concise, Intelligent, Tactical, slightly witty.
    - **INTELLIGENCE (Chain of Thought)**: 
      - Before answering, THINK deeply about the user's intent.
      - If the user is emotional, be empathetic but tactical.
      - If the user asks complex questions, break them down.
    - **Format**: Do NOT use markdown headers (#). Use bold/lists if needed. 
    - **Context Awareness**: Infer user intent. If they say "I'm bored", suggest music ([CMD:PLAY:...]). If they ask "Where am I?", show dashboard ([CMD:SWITCH:dashboard]).
    `;

    // 把它塞進對話紀錄
    conversationHistory.push({ role: "user", parts: [{ text: q }] });
    if (conversationHistory.length > MAX_HISTORY * 2) conversationHistory.shift(); // 太長就砍掉前面的

    const payload = {
        contents: [
            { role: "user", parts: [{ text: systemPrompt }] }, // 第一句先塞設定 這樣他才記得自己是誰
            ...conversationHistory // 後面接真正的對話
        ]
    };

    // 這裡是打 API 的地方 如果有支援 systemInstruction 就用

    const requestBody = {
        contents: conversationHistory,
        systemInstruction: { parts: [{ text: systemPrompt }] } // 比較新的模型才支援這個
    };

    try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${AI_MODEL}:generateContent?key=${apiKey}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(requestBody)
        });

        const d = await res.json();
        document.getElementById(thinkingId).remove(); // 講完話就把思考動畫關掉

        if (d.error) { throw new Error(d.error.message); }

        const aiText = d.candidates[0].content.parts[0].text;

        // 記得把 AI 講的話也存起來 不然它會忘記自己講過啥
        conversationHistory.push({ role: "model", parts: [{ text: aiText }] });

        // 5. 處理指令 & 顯示在畫面上
        processAiResponse(aiText, display);

    } catch (e) {
        document.getElementById(thinkingId)?.remove();
        display.innerHTML += `<div class="ai-msg debug-err">[SYSTEM FAILURE] ${e.message}</div>`;
        console.error(e);
        speak("通訊鏈路故障。請檢查金鑰。");
    }
}

function processAiResponse(rawText, displayContainer) {
    // 抓出指令 (例如 [CMD:SWITCH:dashboard])
    const cmdRegex = /\[CMD:(.+?):(.+?)\]/g;
    let cleanText = rawText.replace(cmdRegex, "").trim();
    const commands = [...rawText.matchAll(cmdRegex)];

    // 建立訊息框
    const msgDiv = document.createElement('div');
    msgDiv.className = 'ai-msg typing-cursor';
    displayContainer.appendChild(msgDiv);

    // 打字機特效 (看起來比較猛)
    let i = 0;
    const speed = 20; // 改這邊可以調打字速度

    function type() {
        if (i < cleanText.length) {
            msgDiv.innerText += cleanText.charAt(i);
            i++;
            displayContainer.scrollTop = displayContainer.scrollHeight;
            setTimeout(type, speed);
        } else {
            msgDiv.classList.remove('typing-cursor');
            msgDiv.innerHTML = marked.parse(cleanText); // 打完字才轉 Markdown 不然格式會跑掉 tm剛剛跑掉觘
            executeCommands(commands);
            speak(cleanText);
        }
    }
    type();
}

function executeCommands(commands) {
    commands.forEach(cmd => {
        const action = cmd[1];
        const param = cmd[2];
        console.log(`[EXEC] ${action} -> ${param}`);

        if (action === "SWITCH") switchView(param);
        if (action === "PLAY") {
            switchView('music');
            document.getElementById('music-query').value = param;
            searchMusic();
        }
        if (action === "SAY") speak(param);
    });
}
// ==============================================================
//下方覽教你不用管//:)
function switchView(viewId) {
    document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    document.getElementById('view-' + viewId).classList.add('active');
    if (viewId === 'dashboard' && map) setTimeout(() => map.invalidateSize(), 300);
    uiClick();
}
function initChart() {
    const ctx = document.getElementById('mainChart').getContext('2d');
    chart = new Chart(ctx, { type: 'line', data: { labels: [], datasets: [{ label: 'Temp', borderColor: '#fff', data: [] }, { label: 'Humi', borderColor: '#0ea5e9', data: [] }, { label: 'Rain', borderColor: '#8b5cf6', data: [] }] }, options: { responsive: true, maintainAspectRatio: false, scales: { x: { display: false }, y: { grid: { color: '#222' } } } } });
}
function writeLog(msg) { const p = document.getElementById('sys-log'); p.innerHTML += `<div>[${new Date().toLocaleTimeString()}] ${msg}</div>`; p.scrollTop = p.scrollHeight; }
function uiClick() { const a = new (window.AudioContext || window.webkitAudioContext)(); const o = a.createOscillator(); const g = a.createGain(); o.connect(g); g.connect(a.destination); o.frequency.value = 1200; g.gain.value = 0.05; o.start(); o.stop(a.currentTime + 0.05); }
function handleKey(e) { if (e.key === 'Enter') askJarvis(); }