// ==========================================
// 1. إعدادات Firebase للمزامنة اللحظية
// ==========================================
const firebaseConfig = {
    apiKey: "AIzaSyA3rk_p6qGDXfnfAUENYSYyXh_F1kslAoM",
    authDomain: "kitchen-app-dab1a.firebaseapp.com",
    databaseURL: "https://kitchen-app-dab1a-default-rtdb.firebaseio.com",
    projectId: "kitchen-app-dab1a",
    storageBucket: "kitchen-app-dab1a.firebasestorage.app",
    messagingSenderId: "147018657287",
    appId: "1:147018657287:web:1ed324d0f7e5eb098a44a2",
    measurementId: "G-2H5F9GO7YV"
};

if (typeof firebase !== 'undefined' && !firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

const db = (typeof firebase !== 'undefined') ? firebase.database() : null;
const timersRef = db ? db.ref('timers') : null;
const tasksRef = db ? db.ref('tasks') : null;
const shoppingRef = db ? db.ref('shopping') : null;

// ==========================================
// 2. المتغيرات العامة وإعدادات النظام
// ==========================================
let timeFormat = '24';
let alarmDuration = 60; // بالثواني (الافتراضي دقيقة)

// إدارات الأصوات والمشغل
let audioPlaylist = []; // قائمة الأصوات [{ name: '...', url: '...' }]
let currentAudioIndex = -1;
let mainAudioPlayer = new Audio(); // لاعب الصوتيات للموسيقى
let isMainAudioPlaying = false;

// إدارات أصوات المنبه لتفادي التداخل
let alarmAudioPlayer = new Audio();
let activeAlarmOscillator = null; 
let activeAlarmAudioCtx = null;
let alarmTimeoutId = null;

let memoryImages = [
    'https://images.unsplash.com/photo-1556911220-e15b29be8c8f?w=1200',
    'https://images.unsplash.com/photo-1556910103-1c02745aae4d?w=1200'
];
let currentMemoryIndex = 0;
let idleInterval = null;

// ==========================================
// 3. تهيئة التطبيق عند التحميل
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    loadSavedSettings();
    renderMemoryList();
    renderSettingsAudioList();
    renderPlaylistDropdown();

    // أحداث انتهاء تشغيل أغنية في المشغل
    mainAudioPlayer.onended = () => {
        isMainAudioPlaying = false;
        updateAudioIcons(false);
    };
});

function loadSavedSettings() {
    // 1. الخلفية
    const bgType = localStorage.getItem('kitchen_bg_type');
    const bgVal = localStorage.getItem('kitchen_bg_val');
    if (bgType && bgVal) {
        if (bgType === 'color') changeBgColor(bgVal, false);
        else setPresetBg(bgVal, false);
    }

    // 2. صيغة الوقت
    const savedFormat = localStorage.getItem('kitchen_time_format');
    if (savedFormat) {
        timeFormat = savedFormat;
        const selectEl = document.getElementById('timeFormatSelect');
        if (selectEl) selectEl.value = savedFormat;
    }

    // 3. مدة الرنين
    const savedDuration = localStorage.getItem('kitchen_alarm_duration');
    if (savedDuration) {
        alarmDuration = parseInt(savedDuration);
        if (alarmDuration > 600) alarmDuration = 600;
        const inputEl = document.getElementById('alarmDurationInput');
        if (inputEl) {
            const m = String(Math.floor(alarmDuration / 60)).padStart(2, '0');
            const s = String(alarmDuration % 60).padStart(2, '0');
            inputEl.value = `${m}:${s}`;
        }
    }

    // 4. صور الذكريات
    const savedMemories = localStorage.getItem('kitchen_memories');
    if (savedMemories) {
        try {
            const parsed = JSON.parse(savedMemories);
            if (Array.isArray(parsed) && parsed.length > 0) memoryImages = parsed;
        } catch (e) { }
    }

    // 5. الأصوات المخصصة
    const savedAudioList = localStorage.getItem('kitchen_audio_playlist');
    if (savedAudioList) {
        try {
            audioPlaylist = JSON.parse(savedAudioList);
            if (audioPlaylist.length > 0) {
                currentAudioIndex = 0;
                updateAudioLabel(audioPlaylist[0].name);
            }
        } catch(e){}
    }

    // 6. الطقس والموقع
    const savedCity = localStorage.getItem('kitchen_city');
    if (savedCity) {
        getWeatherByCityName(savedCity);
    } else {
        getLocationGeo();
    }
}

function showNotification(text) {
    const toast = document.getElementById('settingsNotification');
    if (toast) {
        toast.innerText = text;
        toast.classList.remove('hidden');
        setTimeout(() => { toast.classList.add('hidden'); }, 3000);
    }
}

// ==========================================
// 4. التحكم بالخلفية
// ==========================================
function setPresetBg(url, notify = true) {
    document.body.style.backgroundImage = `url('${url}')`;
    document.body.style.backgroundColor = 'transparent';
    localStorage.setItem('kitchen_bg_type', 'image');
    localStorage.setItem('kitchen_bg_val', url);
    if (notify) showNotification('تم تغيير الخلفية بنجاح');
}

function uploadLocalBg(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (e) { setPresetBg(e.target.result, true); };
    reader.readAsDataURL(file);
}

function changeBgColor(color, notify = true) {
    document.body.style.backgroundImage = 'none';
    document.body.style.backgroundColor = color;
    localStorage.setItem('kitchen_bg_type', 'color');
    localStorage.setItem('kitchen_bg_val', color);
    if (notify) showNotification('تم تغيير لون الخلفية بنجاح');
}

// ==========================================
// 5. نظام الصوتيات والمشغل المطور
// ==========================================

// رفع ملفات صوتية متعددة في وقت واحد
function uploadMultipleAudioFiles(event) {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    let loadedCount = 0;
    Array.from(files).forEach(file => {
        const reader = new FileReader();
        reader.onload = function (e) {
            audioPlaylist.push({
                name: file.name.replace(/\.[^/.]+$/, ""),
                url: e.target.result
            });
            loadedCount++;
            if (loadedCount === files.length) {
                if (currentAudioIndex === -1) currentAudioIndex = 0;
                renderSettingsAudioList();
                renderPlaylistDropdown();
                showNotification(`تم إدراج ${files.length} ملفات صوتية بنجاح`);
            }
        };
        reader.readAsDataURL(file);
    });
}

function saveAudioUrlSetting() {
    const nameInp = document.getElementById('audioNameInput');
    const urlInp = document.getElementById('audioUrlInput');
    if (urlInp && urlInp.value.trim() !== '') {
        const name = (nameInp && nameInp.value.trim()) ? nameInp.value.trim() : 'بث صوتي مباشر';
        audioPlaylist.push({ name: name, url: urlInp.value.trim() });
        if (currentAudioIndex === -1) currentAudioIndex = 0;
        
        urlInp.value = '';
        if(nameInp) nameInp.value = '';
        
        renderSettingsAudioList();
        renderPlaylistDropdown();
        showNotification('تمت إضافة رابط الصوت القائمة');
    }
}

// زر حفظ وتأكيد الأصوات
function confirmAndSaveAudioList() {
    localStorage.setItem('kitchen_audio_playlist', JSON.stringify(audioPlaylist));
    showNotification(`تم حفظ ${audioPlaylist.length} صوت بنجاح في النظام`);
}

function renderSettingsAudioList() {
    const list = document.getElementById('settingsAudioList');
    if (!list) return;
    list.innerHTML = '';
    if (audioPlaylist.length === 0) {
        list.innerHTML = '<li style="color:#aaa;">لا يوجد أصوات مضافة</li>';
        return;
    }
    audioPlaylist.forEach((item, index) => {
        const li = document.createElement('li');
        li.innerHTML = `<span>${item.name}</span> <i class="fa-solid fa-trash" onclick="deleteAudioItem(${index})" style="color:#ff5252; cursor:pointer;"></i>`;
        list.appendChild(li);
    });
}

function deleteAudioItem(index) {
    audioPlaylist.splice(index, 1);
    if (currentAudioIndex >= audioPlaylist.length) currentAudioIndex = audioPlaylist.length - 1;
    renderSettingsAudioList();
    renderPlaylistDropdown();
    confirmAndSaveAudioList();
}

// عرض القائمة المنبثقة للاختيار
function togglePlaylistMenu() {
    const dropdown = document.getElementById('playlistDropdown');
    if (dropdown) dropdown.classList.toggle('hidden');
}

function renderPlaylistDropdown() {
    const container = document.getElementById('playlistItems');
    if (!container) return;
    container.innerHTML = '';

    if (audioPlaylist.length === 0) {
        container.innerHTML = '<li class="empty-msg">لا توجد أصوات مخصصة، أضف ملفات من الإعدادات</li>';
        return;
    }

    audioPlaylist.forEach((item, idx) => {
        const li = document.createElement('li');
        li.className = (idx === currentAudioIndex) ? 'active' : '';
        li.innerHTML = `<i class="fa-solid fa-music"></i> <span>${item.name}</span>`;
        li.onclick = () => selectAudioTrack(idx);
        container.appendChild(li);
    });
}

function selectAudioTrack(index) {
    if (index < 0 || index >= audioPlaylist.length) return;
    currentAudioIndex = index;
    const track = audioPlaylist[index];
    updateAudioLabel(track.name);
    
    // تشغيل مباشر بعد الاختيار
    mainAudioPlayer.src = track.url;
    mainAudioPlayer.play().then(() => {
        isMainAudioPlaying = true;
        updateAudioIcons(true);
    }).catch(() => showNotification('تعذر تشغيل هذا المقطع'));

    renderPlaylistDropdown();
    togglePlaylistMenu();
}

function updateAudioLabel(name) {
    const label = document.getElementById('audioTrackLabel');
    const idleLabel = document.getElementById('idleTrackName');
    if (label) label.innerText = name;
    if (idleLabel) idleLabel.innerText = name;
}

// التشغيل من زر التشغيل الجانبي دون فتح القائمة
function toggleMainAudioPlay(event) {
    if(event) event.stopPropagation();

    if (audioPlaylist.length === 0) {
        showNotification('الرجاء إضافة أصوات من الإعدادات أولاً');
        return;
    }

    if (isMainAudioPlaying) {
        mainAudioPlayer.pause();
        isMainAudioPlaying = false;
        updateAudioIcons(false);
    } else {
        if (currentAudioIndex === -1) currentAudioIndex = 0;
        const track = audioPlaylist[currentAudioIndex];
        
        if (mainAudioPlayer.src !== track.url) {
            mainAudioPlayer.src = track.url;
        }

        mainAudioPlayer.play().then(() => {
            isMainAudioPlaying = true;
            updateAudioIcons(true);
            updateAudioLabel(track.name);
        }).catch(() => showNotification('تعذر تشغيل الصوت'));
    }
}

function updateAudioIcons(playing) {
    const mainIcon = document.getElementById('audioIcon');
    const idleIcon = document.getElementById('idleAudioIcon');
    const iconClass = playing ? 'fa-pause' : 'fa-play';
    if (mainIcon) mainIcon.className = `fa-solid ${iconClass}`;
    if (idleIcon) idleIcon.className = `fa-solid ${iconClass}`;
}

// ==========================================
// 6. إدارة المنبه والأصوات الافتراضية
// ==========================================

function stopAlarmSound() {
    if (alarmAudioPlayer) {
        alarmAudioPlayer.pause();
        alarmAudioPlayer.currentTime = 0;
    }
    
    if (activeAlarmOscillator) {
        try { activeAlarmOscillator.stop(); } catch (e) {}
        activeAlarmOscillator = null;
    }
    if (activeAlarmAudioCtx) {
        try { activeAlarmAudioCtx.close(); } catch (e) {}
        activeAlarmAudioCtx = null;
    }
    if (alarmTimeoutId) {
        clearTimeout(alarmTimeoutId);
        alarmTimeoutId = null;
    }

    const alarmModal = document.getElementById('alarmModal');
    if (alarmModal) alarmModal.style.display = 'none';
}

function startAlarmSound(timerName = 'مؤقت المطبخ', soundType = 'default_1') {
    stopAlarmSound(); // إيقاف أي منبه يعمل مسبقاً

    const modal = document.getElementById('alarmModal');
    const modalText = document.getElementById('alarmModalText');
    if (modal) {
        if (modalText) modalText.innerText = timerName;
        modal.style.display = 'flex';
    }

    // خيارات تشغيل الصوت
    if (soundType === 'custom' && audioPlaylist.length > 0) {
        // تشغيل أول صوت مخصص أو الصوت الحالي
        const targetUrl = audioPlaylist[currentAudioIndex > -1 ? currentAudioIndex : 0].url;
        alarmAudioPlayer.src = targetUrl;
        alarmAudioPlayer.play().catch(() => playSyntheticBeep(soundType));
    } else {
        playSyntheticBeep(soundType);
    }

    // توقيت الإيقاف التلقائي حسب المدة المحددة
    alarmTimeoutId = setTimeout(() => {
        stopAlarmSound();
    }, alarmDuration * 1000);
}

// توليد أصوات افتراضية متعددة
function playSyntheticBeep(type) {
    try {
        activeAlarmAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        activeAlarmOscillator = activeAlarmAudioCtx.createOscillator();
        const gain = activeAlarmAudioCtx.createGain();

        activeAlarmOscillator.connect(gain);
        gain.connect(activeAlarmAudioCtx.destination);

        if (type === 'default_2') { // نغمة هادئة
            activeAlarmOscillator.type = 'triangle';
            activeAlarmOscillator.frequency.value = 440;
        } else if (type === 'default_3') { // جرس إلكتروني
            activeAlarmOscillator.type = 'sawtooth';
            activeAlarmOscillator.frequency.value = 600;
        } else { // تنبيه كلاسيكي
            activeAlarmOscillator.type = 'sine';
            activeAlarmOscillator.frequency.value = 880;
        }

        activeAlarmOscillator.start();
    } catch (e) {}
}

function saveAlarmDuration() {
    const durationInput = document.getElementById('alarmDurationInput');
    if (durationInput && durationInput.value) {
        const parts = durationInput.value.split(':');
        let seconds = (parseInt(parts[0]) * 60) + parseInt(parts[1]);

        if (seconds > 600) {
            seconds = 600;
            durationInput.value = "10:00";
            showNotification('الحد الأقصى المسموح به هو 10 دقائق فقط');
        } else if (seconds <= 0) {
            seconds = 1;
            durationInput.value = "00:01";
        } else {
            showNotification('تم حفظ مدة المنبه بنجاح');
        }

        alarmDuration = seconds;
        localStorage.setItem('kitchen_alarm_duration', alarmDuration);
    }
}

// ==========================================
// 7. الطقس والموقع الجغرافي
// ==========================================
function getLocationGeo() {
    if (navigator.geolocation) {
        showNotification('جاري تحديد الموقع تلقائياً...');
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                fetchWeatherByCoords(pos.coords.latitude, pos.coords.longitude, 'موقعك الحالي');
                localStorage.removeItem('kitchen_city');
            },
            () => {
                showNotification('تعذر الجلب التلقائي، تم الاعتماد على الرياض');
                getWeatherByCityName('الرياض');
            }
        );
    }
}

function setManualCity() {
    const cityInput = document.getElementById('manualCityInput');
    if (cityInput && cityInput.value.trim() !== '') {
        const city = cityInput.value.trim();
        localStorage.setItem('kitchen_city', city);
        getWeatherByCityName(city);
        showNotification(`تم تعيين المدينة: ${city}`);
    }
}

function getWeatherByCityName(cityName) {
    fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1&language=ar`)
        .then(res => res.json())
        .then(data => {
            if (data.results && data.results.length > 0) {
                const { latitude, longitude, name } = data.results[0];
                fetchWeatherByCoords(latitude, longitude, name);
            } else {
                showNotification('لم يتم العثور على المدينة');
            }
        }).catch(() => {});
}

function fetchWeatherByCoords(lat, lon, locationName) {
    fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`)
        .then(res => res.json())
        .then(data => {
            if (data.current_weather) {
                const tempEl = document.getElementById('weatherTemp');
                const locEl = document.getElementById('weatherLocation');
                if (tempEl) tempEl.innerText = `${Math.round(data.current_weather.temperature)}°C`;
                if (locEl) locEl.innerText = locationName;
            }
        }).catch(() => {});
}

// ==========================================
// 8. الساعة والوقت والتاريخ
// ==========================================
function changeTimeFormat(format) {
    timeFormat = format;
    localStorage.setItem('kitchen_time_format', format);
    updateClock();
    showNotification(`تم التحويل إلى توقيت ${format} ساعة`);
}

function updateClock() {
    const now = new Date();
    let hours = now.getHours();
    const minutes = String(now.getMinutes()).padStart(2, '0');
    let timeStr = '';

    if (timeFormat === '12') {
        const periodText = hours >= 12 ? 'م' : 'ص';
        hours = hours % 12 || 12;
        timeStr = `${String(hours).padStart(2, '0')}:${minutes} ${periodText}`;
    } else {
        timeStr = `${String(hours).padStart(2, '0')}:${minutes}`;
    }

    const digitalEl = document.getElementById('digitalClock');
    const idleTimeEl = document.getElementById('idleTime');
    const dateEl = document.getElementById('dateDisplay');

    if (digitalEl) digitalEl.innerText = timeStr;
    if (idleTimeEl) idleTimeEl.innerText = timeStr;

    if (dateEl) {
        const options = { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' };
        dateEl.innerText = now.toLocaleDateString('ar-SA', options);
    }

    const hDeg = (now.getHours() % 12) * 30 + now.getMinutes() * 0.5;
    const mDeg = now.getMinutes() * 6;
    const hourHand = document.getElementById('hourHand');
    const minuteHand = document.getElementById('minuteHand');
    if (hourHand) hourHand.style.transform = `rotate(${hDeg}deg)`;
    if (minuteHand) minuteHand.style.transform = `rotate(${mDeg}deg)`;
}
setInterval(updateClock, 1000);
updateClock();

// ==========================================
// 9. وضع الخمول والصور
// ==========================================
function triggerIdleMode() {
    const idleScreen = document.getElementById('idleScreen');
    if (!idleScreen) return;
    idleScreen.style.display = 'block';
    setTimeout(() => { idleScreen.style.opacity = '1'; }, 10);

    changeSlideshowImage();
    if (idleInterval) clearInterval(idleInterval);
    idleInterval = setInterval(changeSlideshowImage, 5000);
}

function wakeUp() {
    const idleScreen = document.getElementById('idleScreen');
    if (!idleScreen) return;
    idleScreen.style.opacity = '0';
    setTimeout(() => { idleScreen.style.display = 'none'; }, 1000);
    if (idleInterval) clearInterval(idleInterval);
}

function changeSlideshowImage() {
    const slideshow = document.getElementById('slideshow');
    if (slideshow && memoryImages.length > 0) {
        slideshow.style.backgroundImage = `url('${memoryImages[currentMemoryIndex]}')`;
        currentMemoryIndex = (currentMemoryIndex + 1) % memoryImages.length;
    }
}

function uploadLocalMemoryImg(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (evt) {
        memoryImages.push(evt.target.result);
        localStorage.setItem('kitchen_memories', JSON.stringify(memoryImages));
        renderMemoryList();
        showNotification('تم إثراء الذكريات بصورة جديدة');
    };
    reader.readAsDataURL(file);
}

function addMemoryImage() {
    const input = document.getElementById('newMemoryImg');
    if (input && input.value.trim() !== '') {
        memoryImages.push(input.value.trim());
        localStorage.setItem('kitchen_memories', JSON.stringify(memoryImages));
        input.value = '';
        renderMemoryList();
        showNotification('تمت إضافة رابط الصورة');
    }
}

function renderMemoryList() {
    const list = document.getElementById('memoryImageList');
    if (!list) return;
    list.innerHTML = '';
    memoryImages.forEach((imgUrl, idx) => {
        const li = document.createElement('li');
        li.innerHTML = `<span>صورة #${idx + 1}</span> <i class="fa-solid fa-trash" onclick="deleteMemoryImg(${idx})" style="color:#ff5252; cursor:pointer;"></i>`;
        list.appendChild(li);
    });
}

function deleteMemoryImg(index) {
    memoryImages.splice(index, 1);
    localStorage.setItem('kitchen_memories', JSON.stringify(memoryImages));
    renderMemoryList();
}

// ==========================================
// 10. المؤقتات (Firebase)
// ==========================================
let timers = [];

if (timersRef) {
    timersRef.on('value', (snapshot) => {
        const data = snapshot.val();
        timers = data ? Object.keys(data).map(key => ({ id: key, ...data[key] })) : [];
        renderTimers();
    });
}

function renderTimers() {
    const container = document.getElementById('timersContainer');
    if (!container) return;
    container.innerHTML = '';

    timers.forEach(t => {
        const box = document.createElement('div');
        box.className = 'timer-box';
        box.innerHTML = `
            <i class="fa-solid fa-xmark delete-timer-btn" onclick="deleteTimer('${t.id}')"></i>
            <span style="font-weight:bold; color:#ff9800; font-size:0.9rem;">${t.name}</span>
            <div class="timer-display">${formatTimerTime(t.currentSec)}</div>
            <div class="timer-controls">
                <button onclick="toggleTimer('${t.id}')"><i class="fa-solid ${t.running ? 'fa-pause' : 'fa-play'}"></i></button>
                <button onclick="resetTimer('${t.id}')"><i class="fa-solid fa-rotate-right"></i></button>
            </div>
        `;
        container.appendChild(box);
    });
}

function formatTimerTime(sec) {
    const h = String(Math.floor(sec / 3600)).padStart(2, '0');
    const m = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
    const s = String(sec % 60).padStart(2, '0');
    return h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`;
}

function showAddTimerInputs() {
    const form = document.getElementById('addTimerForm');
    if (form) form.classList.toggle('hidden');
}

function addNewTimer() {
    const nameInp = document.getElementById('newTimerName');
    const hInp = document.getElementById('newTimerH');
    const mInp = document.getElementById('newTimerM');
    const sInp = document.getElementById('newTimerS');
    const soundSelect = document.getElementById('newTimerSound');

    const name = (nameInp && nameInp.value.trim()) || 'مؤقت';
    const h = parseInt(hInp ? hInp.value : 0) || 0;
    const m = parseInt(mInp ? mInp.value : 0) || 0;
    const s = parseInt(sInp ? sInp.value : 0) || 0;
    const sound = soundSelect ? soundSelect.value : 'default_1';

    let total = (h * 3600) + (m * 60) + s;
    if (total < 1) total = 1;

    if (timersRef) {
        timersRef.push({ name, totalSec: total, currentSec: total, running: false, sound: sound });
    }
    showAddTimerInputs();
}

function deleteTimer(id) { if (timersRef) timersRef.child(id).remove(); }

function toggleTimer(id) {
    const t = timers.find(x => x.id === id);
    if (!t || !timersRef) return;
    timersRef.child(id).update({ running: !t.running });
}

function resetTimer(id) {
    const t = timers.find(x => x.id === id);
    if (!t || !timersRef) return;
    timersRef.child(id).update({ currentSec: t.totalSec, running: false });
}

setInterval(() => {
    timers.forEach(t => {
        if (t.running && t.currentSec > 0) {
            t.currentSec--;
            renderTimers();
            if (t.currentSec === 0) {
                if (timersRef) timersRef.child(t.id).update({ currentSec: 0, running: false });
                startAlarmSound(t.name, t.sound || 'default_1');
            }
        }
    });
}, 1000);

// ==========================================
// 11. قائمة التسوق والمهام الذكية
// ==========================================
if (tasksRef) {
    tasksRef.on('value', (snapshot) => {
        const data = snapshot.val() || {};
        const todoList = document.getElementById('todoList');
        if (!todoList) return;
        todoList.innerHTML = '';
        Object.keys(data).forEach(key => {
            const li = document.createElement('li');
            li.innerHTML = `<span>${data[key].text}</span> <i class="fa-solid fa-trash" onclick="removeTask('${key}')" style="cursor:pointer; color:#ff5252;"></i>`;
            todoList.appendChild(li);
        });
    });
}

if (shoppingRef) {
    shoppingRef.on('value', (snapshot) => {
        const data = snapshot.val() || {};
        const shoppingList = document.getElementById('shoppingList');
        if (!shoppingList) return;
        shoppingList.innerHTML = '';
        Object.keys(data).forEach(key => {
            const li = document.createElement('li');
            li.innerHTML = `<span>${data[key].text}</span> <i class="fa-solid fa-trash" onclick="removeShoppingItem('${key}')" style="cursor:pointer; color:#ff5252;"></i>`;
            shoppingList.appendChild(li);
        });
    });
}

function addItem() {
    const input = document.getElementById('taskInput');
    if (!input) return;
    const val = input.value.trim();
    if (!val) return;

    const shoppingKeywords = ['حليب', 'خبز', 'طماطم', 'شراء', 'زيت', 'سكر', 'شاي', 'لحم', 'دجاج'];
    const isShopping = shoppingKeywords.some(kw => val.includes(kw));

    if (isShopping && shoppingRef) {
        shoppingRef.push({ text: val });
    } else if (tasksRef) {
        tasksRef.push({ text: val });
    }
    input.value = '';
}

function removeTask(key) { if (tasksRef) tasksRef.child(key).remove(); }
function removeShoppingItem(key) { if (shoppingRef) shoppingRef.child(key).remove(); }

// ==========================================
// 12. النوافذ المنبثقة
// ==========================================
function openSettings() {
    const modal = document.getElementById('settingsModal');
    if (modal) modal.style.display = 'flex';
}

function closeSettings() {
    const modal = document.getElementById('settingsModal');
    if (modal) modal.style.display = 'none';
}

function generateRecipe() {
    const input = document.getElementById('ingredientsInput');
    const output = document.getElementById('recipeOutput');
    if (input && output && input.value.trim() !== '') {
        output.innerText = `وجبة اقتراح بناءً على (${input.value}):\nصينية خضار مشوية مع إضافة التوابل وزيت الزيتون وتدخل الفرن لمدة 25 دقيقة.`;
    }
}

function showSubstitutes() {
    const output = document.getElementById('recipeOutput');
    if (output) {
        output.innerText = "بدائل متوفرة:\n• الزبدة ⬅ زيت زيتون أو زيوت نباتية\n• الحليب ⬅ لبن أو زبادي مخفف بالماء\n• الليمون ⬅ خل أبيض";
    }
}