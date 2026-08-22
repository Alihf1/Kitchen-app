// ==========================================
// إعدادات Firebase والمزامنة الأساسية
// ==========================================
const firebaseConfig = {
    apiKey: "AIzaSyA3rk_p6qGDXfnfAUENYSYyXh_F1kslAoM",
    authDomain: "kitchen-app-dab1a.firebaseapp.com",
    databaseURL: "https://kitchen-app-dab1a-default-rtdb.firebaseio.com",
    projectId: "kitchen-app-dab1a",
    storageBucket: "kitchen-app-dab1a.firebasestorage.app",
    messagingSenderId: "147018657287",
    appId: "1:147018657287:web:1ed324d0f7e5eb098a44a2"
};

if (typeof firebase !== 'undefined' && !firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

const db = (typeof firebase !== 'undefined') ? firebase.database() : null;
const timersRef = db ? db.ref('timers') : null;
const tasksRef = db ? db.ref('tasks') : null;
const settingsRef = db ? db.ref('settings') : null;
const audioPlayerRef = db ? db.ref('audioPlayerState') : null;
const idleModeRef = db ? db.ref('idleModeState') : null;

// توافق المتصفحات القديمة (iPad iOS 10): بديل بسيط عن fetch
if (!window.fetch) {
    window.fetch = function (url) {
        return new Promise(function (resolve, reject) {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', url, true);
            xhr.onload = function () {
                resolve({
                    ok: xhr.status >= 200 && xhr.status < 300,
                    json: function () { return Promise.resolve(JSON.parse(xhr.responseText)); }
                });
            };
            xhr.onerror = function () { reject(new Error('network')); };
            xhr.send();
        });
    };
}

let timeFormat = '24';
let alarmDuration = 60;
let showClock = true;
let showWeather = true;

let audioPlaylist = [];
let currentAudioIndex = -1;
let mainAudioPlayer = new Audio();
let isMainAudioPlaying = false;

let alarmAudioPlayer = new Audio();

let memoryImages = [
    'https://images.unsplash.com/photo-1556911220-e15b29be8c8f?w=1200',
    'https://images.unsplash.com/photo-1556910103-1c02745aae4d?w=1200'
];
let currentMemoryIndex = 0;
let imageRotationIntervalTime = 10000;
let imageRotationTimer = null;
let idleInterval = null;

let menuGraceTimer = null;
let menusOpenedAt = 0;
const OPEN_GUARD_MS = 450;
const FALLBACK_CLOSE_MS = 6000;
const MENU_ACTIVITY_EVENTS = ['click', 'input', 'keydown', 'touchstart'];

document.addEventListener('DOMContentLoaded', () => {
    initRealtimeSync();
    updateMainCustomImage();
    startImageRotation();

    mainAudioPlayer.onended = () => {
        isMainAudioPlaying = false;
        updateAudioIcons(false);
        if (audioPlayerRef) audioPlayerRef.update({ isPlaying: false });
    };

    setupHoverClose();
    setupAutoHideControls();
});

function initRealtimeSync() {
    if (!db) return;

    settingsRef.on('value', (snapshot) => {
        const settings = snapshot.val();
        if (!settings) return;

        if (settings.bgType && settings.bgVal) {
            if (settings.bgType === 'color') changeBgColorUI(settings.bgVal);
            else setPresetBgUI(settings.bgVal);
        }

        if (settings.timeFormat) {
            timeFormat = settings.timeFormat;
            const selectEl = document.getElementById('timeFormatSelect');
            if (selectEl) selectEl.value = settings.timeFormat;
            updateClock();
        }

        if (settings.imageInterval) {
            imageRotationIntervalTime = parseInt(settings.imageInterval);
            const intervalSelect = document.getElementById('imageRotateIntervalSelect');
            if (intervalSelect) intervalSelect.value = imageRotationIntervalTime;
            startImageRotation();
        }

        if (settings.showClock !== undefined) {
            showClock = settings.showClock;
            applyVisibility('clockWidget', 'toggleClockBtn', showClock);
        }
        if (settings.showWeather !== undefined) {
            showWeather = settings.showWeather;
            applyVisibility('weatherWidget', 'toggleWeatherBtn', showWeather);
        }

        if (settings.alarmDuration) {
            alarmDuration = parseInt(settings.alarmDuration);
        }

        if (settings.memories && Array.isArray(settings.memories)) {
            memoryImages = settings.memories;
            renderMemoryList();
            updateMainCustomImage();
        }

        if (settings.playlist && Array.isArray(settings.playlist)) {
            audioPlaylist = settings.playlist;
            renderSettingsAudioList();
            renderPlaylistDropdown();
        }

        if (settings.city) {
            getWeatherByCityName(settings.city);
        }
    });

    audioPlayerRef.on('value', (snapshot) => {
        const state = snapshot.val();
        if (!state) return;

        if (typeof state.currentIndex === 'number' && state.currentIndex !== currentAudioIndex) {
            currentAudioIndex = state.currentIndex;
            if (audioPlaylist[currentAudioIndex]) {
                updateAudioLabel(audioPlaylist[currentAudioIndex].name);
                mainAudioPlayer.src = audioPlaylist[currentAudioIndex].url;
            }
            renderPlaylistDropdown();
        }

        if (state.isPlaying !== undefined && state.isPlaying !== isMainAudioPlaying) {
            isMainAudioPlaying = state.isPlaying;
            updateAudioIcons(isMainAudioPlaying);
            if (isMainAudioPlaying) {
                if (audioPlaylist[currentAudioIndex] && mainAudioPlayer.src !== audioPlaylist[currentAudioIndex].url) {
                    mainAudioPlayer.src = audioPlaylist[currentAudioIndex].url;
                }
                mainAudioPlayer.play().catch(() => {});
            } else {
                mainAudioPlayer.pause();
            }
        }
    });

    idleModeRef.on('value', (snapshot) => {
        const state = snapshot.val();
        if (!state) return;
        if (state.active) triggerIdleModeUI();
        else wakeUpUI();
    });

    settingsRef.child('city').once('value', (snap) => {
        if (!snap.val()) getLocationGeo();
    });
}

function showNotification(text) {
    const toast = document.getElementById('settingsNotification');
    if (toast) {
        toast.innerText = text;
        toast.classList.remove('hidden');
        setTimeout(() => { toast.classList.add('hidden'); }, 3000);
    }
}

// التحكم بالإظهار والإخفاء (الساعة والطقس)
function toggleClockVisibility() {
    showClock = !showClock;
    if (settingsRef) settingsRef.update({ showClock: showClock });
}

function toggleWeatherVisibility() {
    showWeather = !showWeather;
    if (settingsRef) settingsRef.update({ showWeather: showWeather });
}

function applyVisibility(elementId, buttonId, isVisible) {
    const el = document.getElementById(elementId);
    const btn = document.getElementById(buttonId);
    if (el) el.style.display = isVisible ? 'flex' : 'none';
    if (btn) {
        btn.innerText = isVisible ? 'إخفاء' : 'إظهار';
        btn.classList.toggle('off', !isVisible);
    }
}

// إخفاء أزرار التحكم (الإعدادات والقائمة المميزة) في الواجهة الرئيسية عند عدم الحركة
let uiControlsTimer = null;
const UI_HIDE_DELAY_MS = 3000;

function setupAutoHideControls() {
    const topActions = document.querySelector('.top-actions');
    const dashboard = document.getElementById('dashboard');
    if (!topActions || !dashboard) return;

    // عند الإخفاء يتمدد المحتوى الرئيسي (المهام والصور) لملء الشاشة
    const setIdle = (idle) => {
        topActions.classList.toggle('controls-hidden', idle);
        dashboard.classList.toggle('controls-idle', idle);
    };

    const scheduleHide = () => {
        clearTimeout(uiControlsTimer);
        uiControlsTimer = setTimeout(() => {
            // لا نخفي الأزرار ما دامت إحدى النوافذ مفتوحة
            const specialModal = document.getElementById('specialMenuModal');
            const specialOpen = specialModal && !specialModal.classList.contains('hidden');
            const settingsModal = document.getElementById('settingsModal');
            const settingsOpen = settingsModal && settingsModal.style.display === 'flex';
            if (!specialOpen && !settingsOpen) setIdle(true);
        }, UI_HIDE_DELAY_MS);
    };

    const revealControls = () => {
        setIdle(false);
        scheduleHide();
    };

    document.addEventListener('mousemove', revealControls);
    document.addEventListener('touchstart', revealControls);

    scheduleHide();
}

// إغلاق القوائم بمجرد رجوع الماوس إلى الواجهة الرئيسية
function setupHoverClose() {
    const specialModal = document.getElementById('specialMenuModal');
    const specialContent = document.getElementById('specialMenuContent');
    const settingsModal = document.getElementById('settingsModal');
    const settingsContent = document.getElementById('settingsModalContent');

    // ما دام الماوس داخل النافذة تبقى مفتوحة، وفور خروجه تغلق
    if (specialContent) {
        specialContent.addEventListener('mouseenter', cancelMenuGraceTimer);
        specialContent.addEventListener('mouseleave', closeAllMenus);
        keepMenuOpenWhileActive(specialContent);
    }
    if (settingsContent) {
        settingsContent.addEventListener('mouseenter', cancelMenuGraceTimer);
        settingsContent.addEventListener('mouseleave', closeAllMenus);
        keepMenuOpenWhileActive(settingsContent);
    }

    // أي حركة ماوس خارج صندوق النافذة المفتوحة = المستخدم في الواجهة => إغلاق فوري
    document.addEventListener('mousemove', (e) => {
        const specialOpen = specialModal && !specialModal.classList.contains('hidden');
        const settingsOpen = settingsModal && settingsModal.style.display === 'flex';
        if (!specialOpen && !settingsOpen) return;
        if (Date.now() - menusOpenedAt < OPEN_GUARD_MS) return;

        if (specialOpen && !isPointerInside(specialContent, e)) { closeAllMenus(); return; }
        if (settingsOpen && !isPointerInside(settingsContent, e)) closeAllMenus();
    });

    const playlistDropdown = document.getElementById('playlistDropdown');
    if (playlistDropdown) {
        playlistDropdown.addEventListener('mouseleave', () => playlistDropdown.classList.add('hidden'));
    }
}

// للمس والكتابة: كل تفاعل داخل النافذة يجدد مدة بقائها مفتوحة
function keepMenuOpenWhileActive(contentEl) {
    MENU_ACTIVITY_EVENTS.forEach(evt => {
        contentEl.addEventListener(evt, () => {
            cancelMenuGraceTimer();
            if (!contentEl.matches(':hover')) {
                menuGraceTimer = setTimeout(closeAllMenus, FALLBACK_CLOSE_MS);
            }
        });
    });
}

function isPointerInside(el, e) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return e.clientX >= r.left && e.clientX <= r.right &&
           e.clientY >= r.top && e.clientY <= r.bottom;
}

// احتياط: إذا فُتحت النافذة وبقيت دون أي تفاعل، تغلق تلقائياً
function armMenuGraceTimer() {
    cancelMenuGraceTimer();
    menuGraceTimer = setTimeout(closeAllMenus, FALLBACK_CLOSE_MS);
}

function cancelMenuGraceTimer() {
    if (menuGraceTimer) {
        clearTimeout(menuGraceTimer);
        menuGraceTimer = null;
    }
}

function closeAllMenus() {
    closeSpecialMenu();
    closeSettings();
    const dropdown = document.getElementById('playlistDropdown');
    if (dropdown) dropdown.classList.add('hidden');
}

function toggleSpecialMenu() {
    const modal = document.getElementById('specialMenuModal');
    if (!modal) return;
    modal.classList.toggle('hidden');
    if (!modal.classList.contains('hidden')) {
        menusOpenedAt = Date.now();
        armMenuGraceTimer();
    } else {
        cancelMenuGraceTimer();
    }
}

function openSettings() {
    const modal = document.getElementById('settingsModal');
    if (!modal) return;
    modal.style.display = 'flex';
    menusOpenedAt = Date.now();
    armMenuGraceTimer();
}

function closeSettings() {
    const modal = document.getElementById('settingsModal');
    if (modal) modal.style.display = 'none';
    cancelMenuGraceTimer();
}

function closeSpecialMenu() {
    const modal = document.getElementById('specialMenuModal');
    if (modal) modal.classList.add('hidden');
    cancelMenuGraceTimer();
}

function closeSpecialMenuOnBackdrop(e) {
    if (e.target.id === 'specialMenuModal') toggleSpecialMenu();
}

function closeSettingsOnBackdrop(e) {
    if (e.target.id === 'settingsModal') closeSettings();
}

// تبديل سرعة دوران الصورة المخصصة
function changeImageInterval(val) {
    imageRotationIntervalTime = parseInt(val);
    if (settingsRef) settingsRef.update({ imageInterval: imageRotationIntervalTime });
    startImageRotation();
}

function startImageRotation() {
    if (imageRotationTimer) clearInterval(imageRotationTimer);
    imageRotationTimer = setInterval(rotateMainCustomImage, imageRotationIntervalTime);
}

function rotateMainCustomImage() {
    if (memoryImages.length > 0) {
        currentMemoryIndex = (currentMemoryIndex + 1) % memoryImages.length;
        updateMainCustomImage();
    }
}

function updateMainCustomImage() {
    const container = document.getElementById('mainCustomImageView');
    if (!container) return;
    if (memoryImages.length > 0) {
        const imgUrl = memoryImages[currentMemoryIndex % memoryImages.length];
        container.style.backgroundImage = `url('${imgUrl}')`;
        container.style.backgroundSize = 'cover';
        container.style.backgroundPosition = 'center';
        container.innerHTML = '';
    } else {
        container.style.backgroundImage = 'none';
        container.innerHTML = '<span>الصور الخاصة</span>';
    }
}

// الخلفيات
function setPresetBg(url) {
    if (settingsRef) settingsRef.update({ bgType: 'image', bgVal: url });
    showNotification('تم تغيير الخلفية');
}
function setPresetBgUI(url) {
    document.body.style.backgroundImage = `url('${url}')`;
    document.body.style.backgroundColor = 'transparent';
}
function uploadLocalBg(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (e) { setPresetBg(e.target.result); };
    reader.readAsDataURL(file);
}
function changeBgColor(color) {
    if (settingsRef) settingsRef.update({ bgType: 'color', bgVal: color });
}
function changeBgColorUI(color) {
    document.body.style.backgroundImage = 'none';
    document.body.style.backgroundColor = color;
}

// حل مشكلة إضافة وحذف المقاطع الصوتية
function uploadMultipleAudioFiles(event) {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    let loadedCount = 0;
    Array.from(files).forEach(file => {
        const reader = new FileReader();
        reader.onload = function (e) {
            audioPlaylist.push({ name: file.name.replace(/\.[^/.]+$/, ""), url: e.target.result });
            loadedCount++;
            if (loadedCount === files.length) {
                if (currentAudioIndex === -1) currentAudioIndex = 0;
                if (settingsRef) settingsRef.update({ playlist: audioPlaylist });
                showNotification('تم إضافة الصوت بنجاح');
            }
        };
        reader.readAsDataURL(file);
    });
}

function renderSettingsAudioList() {
    const list = document.getElementById('settingsAudioList');
    if (!list) return;
    list.innerHTML = '';
    audioPlaylist.forEach((item, index) => {
        const li = document.createElement('li');
        li.innerHTML = `<span>${item.name}</span> <i class="fa-solid fa-trash" onclick="deleteAudioItem(${index})" style="color:#ff5252; cursor:pointer;"></i>`;
        list.appendChild(li);
    });
}

function deleteAudioItem(index) {
    audioPlaylist.splice(index, 1);
    if (currentAudioIndex >= audioPlaylist.length) currentAudioIndex = audioPlaylist.length - 1;
    if (settingsRef) settingsRef.update({ playlist: audioPlaylist });
    showNotification('تم حذف الصوت');
}

function togglePlaylistMenu() {
    const dropdown = document.getElementById('playlistDropdown');
    if (dropdown) dropdown.classList.toggle('hidden');
}

function renderPlaylistDropdown() {
    const container = document.getElementById('playlistItems');
    if (!container) return;
    container.innerHTML = '';
    if (audioPlaylist.length === 0) {
        container.innerHTML = '<li class="empty-msg">لا توجد أصوات مضافة</li>';
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
    currentAudioIndex = index;
    if (audioPlayerRef) audioPlayerRef.update({ currentIndex: index, isPlaying: true });
    togglePlaylistMenu();
}

function updateAudioLabel(name) {
    const label = document.getElementById('audioTrackLabel');
    if (label) label.innerText = name;
}

function toggleMainAudioPlay(event) {
    if (event) event.stopPropagation();
    if (audioPlaylist.length === 0) {
        showNotification('أضف أصواتاً من الإعدادات أولاً');
        return;
    }
    if (currentAudioIndex === -1) currentAudioIndex = 0;
    if (audioPlayerRef) {
        audioPlayerRef.update({ currentIndex: currentAudioIndex, isPlaying: !isMainAudioPlaying });
    }
}

function updateAudioIcons(playing) {
    const mainIcon = document.getElementById('audioIcon');
    if (mainIcon) mainIcon.className = `fa-solid ${playing ? 'fa-pause' : 'fa-play'}`;
}

// حل مشكلة وقت المؤقت
function showAddTimerInputs() {
    document.getElementById('addTimerForm').classList.toggle('hidden');
}

function addNewTimer() {
    const name = document.getElementById('newTimerName').value || 'مؤقت';
    const hours = parseInt(document.getElementById('newTimerH').value) || 0;
    const minutes = parseInt(document.getElementById('newTimerM').value) || 0;
    const seconds = parseInt(document.getElementById('newTimerS').value) || 0;

    const totalSeconds = (hours * 3600) + (minutes * 60) + seconds;

    if (totalSeconds <= 0) {
        showNotification('يرجى تحديد وقت أكبر من 0');
        return;
    }

    if (timersRef) {
        timersRef.push({ name: name, totalSec: totalSeconds, currentSec: totalSeconds, running: false });
    }
    showAddTimerInputs();
}

function stopAlarmSound() {
    if (alarmAudioPlayer) {
        alarmAudioPlayer.pause();
        alarmAudioPlayer.currentTime = 0;
    }
    const modal = document.getElementById('alarmModal');
    if (modal) modal.style.display = 'none';
}

function startAlarmSound(timerName = 'مؤقت', soundType = 'default_1') {
    const modal = document.getElementById('alarmModal');
    const modalText = document.getElementById('alarmModalText');
    if (modal) {
        if (modalText) modalText.innerText = timerName;
        modal.style.display = 'flex';
    }
    if (soundType === 'custom' && audioPlaylist.length > 0) {
        alarmAudioPlayer.src = audioPlaylist[0].url;
        alarmAudioPlayer.play().catch(() => {});
    }
}

function saveAlarmDuration() {
    showNotification('تم الحفظ');
}

// خدمة الطقس والموقع
function getLocationGeo() {
    showNotification('جاري تحديد موقعك الحالي...');
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition((pos) => {
            fetchWeatherByCoords(pos.coords.latitude, pos.coords.longitude, 'موقعك الحالي');
            showNotification('تم تحديث الطقس بناءً على موقع الجهاز');
        }, () => {
            showNotification('عذراً، متعذر الوصول للموقع. تم اختيار الرياض كافتراضي');
            setManualCityName('الرياض');
        });
    } else {
        showNotification('متصفحك لا يدعم خدمة الموقع');
    }
}

function setManualCity() {
    const cityInput = document.getElementById('manualCityInput');
    if (cityInput && cityInput.value.trim() !== '') setManualCityName(cityInput.value.trim());
}

function setManualCityName(cityName) {
    if (settingsRef) settingsRef.update({ city: cityName });
}

function getWeatherByCityName(cityName) {
    fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1&language=ar`)
        .then(res => res.json())
        .then(data => {
            if (data.results && data.results.length > 0) {
                const { latitude, longitude, name } = data.results[0];
                fetchWeatherByCoords(latitude, longitude, name);
            }
        });
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
        });
}

// الوقت
function changeTimeFormat(format) {
    timeFormat = format;
    if (settingsRef) settingsRef.update({ timeFormat: format });
}

function updateClock() {
    const now = new Date();
    let hours = now.getHours();
    const minutes = String(now.getMinutes()).padStart(2, '0');
    let timeStr = timeFormat === '12' ? `${hours % 12 || 12}:${minutes}` : `${String(hours).padStart(2, '0')}:${minutes}`;
    
    document.getElementById('digitalClock').innerText = timeStr;
    const idleTime = document.getElementById('idleTime');
    if (idleTime) idleTime.innerText = timeStr;
    
    const dateEl = document.getElementById('dateDisplay');
    if (dateEl) dateEl.innerText = now.toLocaleDateString('ar-SA');
}
setInterval(updateClock, 1000);
updateClock();

// صور الذكريات والخمول
function triggerIdleMode() {
    if (idleModeRef) idleModeRef.update({ active: true });
}
function wakeUp() {
    if (idleModeRef) idleModeRef.update({ active: false });
}
function triggerIdleModeUI() {
    document.getElementById('idleScreen').style.display = 'block';
    setTimeout(() => { document.getElementById('idleScreen').style.opacity = '1'; }, 10);
    changeSlideshowImage();
    if (idleInterval) clearInterval(idleInterval);
    idleInterval = setInterval(changeSlideshowImage, 5000);
}
function wakeUpUI() {
    const idle = document.getElementById('idleScreen');
    idle.style.opacity = '0';
    setTimeout(() => { idle.style.display = 'none'; }, 1000);
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
        if (settingsRef) settingsRef.update({ memories: memoryImages });
        updateMainCustomImage();
        showNotification('تمت إضافة الصورة بنجاح');
    };
    reader.readAsDataURL(file);
}
function renderMemoryList() {
    const list = document.getElementById('memoryImageList');
    if (!list) return;
    list.innerHTML = '';
    memoryImages.forEach((_, idx) => {
        const li = document.createElement('li');
        li.innerHTML = `<span>صورة #${idx + 1}</span> <i class="fa-solid fa-trash" onclick="deleteMemoryImg(${idx})" style="color:#ff5252; cursor:pointer;"></i>`;
        list.appendChild(li);
    });
}
function deleteMemoryImg(index) {
    memoryImages.splice(index, 1);
    if (settingsRef) settingsRef.update({ memories: memoryImages });
    updateMainCustomImage();
}

// المؤقتات
let timers = [];
if (timersRef) {
    timersRef.on('value', (snapshot) => {
        const data = snapshot.val();
        timers = data ? Object.keys(data).map((key) => {
            const timerData = Object.assign({}, data[key]);
            timerData.id = key;
            return timerData;
        }) : [];
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
            <span>${t.name}</span>
            <div class="timer-display">${formatTimerTime(t.currentSec)}</div>
            <button onclick="toggleTimer('${t.id}')"><i class="fa-solid ${t.running ? 'fa-pause' : 'fa-play'}"></i></button>
        `;
        container.appendChild(box);
    });
}

function formatTimerTime(sec) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) {
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function deleteTimer(id) { if (timersRef) timersRef.child(id).remove(); }
function toggleTimer(id) {
    const t = timers.find(x => x.id === id);
    if (t && timersRef) timersRef.child(id).update({ running: !t.running });
}

setInterval(() => {
    timers.forEach(t => {
        if (t.running && t.currentSec > 0) {
            t.currentSec--;
            renderTimers();
            if (t.currentSec === 0) {
                if (timersRef) timersRef.child(t.id).update({ running: false });
                startAlarmSound(t.name);
            }
        }
    });
}, 1000);

// المهام
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
function addItem() {
    const input = document.getElementById('taskInput');
    if (input && input.value.trim() !== '') {
        if (tasksRef) tasksRef.push({ text: input.value.trim() });
        input.value = '';
    }
}
function removeTask(key) { if (tasksRef) tasksRef.child(key).remove(); }

// ==========================================
// مساعد الوصفات بالذكاء الاصطناعي (Puter.js - مجاني بدون مفتاح)
// ==========================================
function callAI(prompt) {
    // مكتوبة بأسلوب Promise القديم لتوافق iOS 10 (بدون async/await)
    return new Promise((resolve, reject) => {
        if (typeof puter === 'undefined' || !puter.ai) {
            reject(new Error('ai-unavailable'));
            return;
        }
        puter.ai.chat(prompt).then((response) => {
            const text = extractAIText(response);
            // بعض أخطاء Puter ترجع كنص ناجح بدل الاستثناء، نكتشفها ونحولها لاستثناء
            if (!text || /ERROR|Cannot read|does not support|not authenticated|rate limit/i.test(text)) {
                reject(new Error('ai-error'));
                return;
            }
            resolve(text);
        }).catch(reject);
    });
}

function extractAIText(res) {
    if (!res) return '';
    if (typeof res === 'string') return res;
    if (res.message) {
        const c = res.message.content;
        if (typeof c === 'string') return c;
        if (Array.isArray(c)) return c.map(part => part.text || '').join('\n');
    }
    if (typeof res.text === 'string') return res.text;
    return String(res);
}

let lastSuggestedIngredients = '';

// الخطوة 1: اقتراح أسماء أطباق حسب المكونات
function suggestDishes() {
    const input = document.getElementById('ingredientsInput');
    const output = document.getElementById('recipeOutput');
    const box = document.getElementById('dishSuggestions');
    const ingredients = input ? input.value.trim() : '';

    if (!ingredients) {
        showNotification('أدخل المكونات أولاً');
        return;
    }

    lastSuggestedIngredients = ingredients;
    output.innerText = 'جاري اقتراح الأطباق المناسبة لمكوناتك...';
    if (box) box.classList.add('hidden');

    callAI(
        'أنت طاهٍ محترف. المستخدم يملك هذه المكونات: ' + ingredients + '\n' +
        'اقترح له 5 أطباق شهية يمكن تحضيرها بها (مثال: مكرونة حمراء، كبسة دجاج، رز مندي). ' +
        'اكتب أسماء الأطباق فقط، كل اسم في سطر منفصل، بدون أرقام أو رموز أو أي شرح إضافي.'
    ).then((raw) => {
        const dishes = parseDishNames(raw);
        if (!dishes.length) throw new Error('empty');
        renderDishSuggestions(dishes);
        output.innerText = 'اختر طبقاً من الاقتراحات لعرض وصفته كاملة:';
    }).catch(() => {
        output.innerText = 'خدمة الذكاء الاصطناعي غير متاحة على هذا الجهاز، تأكد من الاتصال بالإنترنت وحاول مجدداً.';
    });
}

function parseDishNames(raw) {
    return String(raw)
        .split(/\n|،|,|\|/)
        .map(s => s.replace(/^[\s\-–—*•.0-9]+[.)]?\s*/, '').trim())
        .filter(s => s.length > 1 && s.length < 60)
        .slice(0, 8);
}

// عرض الاقتراحات كأزرار قابلة للاختيار
function renderDishSuggestions(dishes) {
    const box = document.getElementById('dishSuggestions');
    if (!box) return;
    box.innerHTML = '';
    dishes.forEach(name => {
        const chip = document.createElement('span');
        chip.className = 'dish-chip';
        chip.innerText = name;
        chip.onclick = () => selectDish(name, chip);
        box.appendChild(chip);
    });
    box.classList.remove('hidden');
}

// الخطوة 2: عند اختيار الطبق تظهر الوصفة الكاملة
function selectDish(dishName, chipEl) {
    const output = document.getElementById('recipeOutput');

    document.querySelectorAll('.dish-chip.selected').forEach(c => c.classList.remove('selected'));
    if (chipEl) chipEl.classList.add('selected');

    output.innerText = 'جاري تجهيز وصفة «' + dishName + '» ...';

    callAI(
        'أنت طاهٍ محترف. اكتب بالعربية وصفة عملية مفصلة للطبق التالي: «' + dishName + '»\n' +
        'مع مراعاة أن المستخدم يملك هذه المكونات: ' + (lastSuggestedIngredients || 'غير محددة') + '\n' +
        'الصيغة: اسم الطبق، وقت التحضير، المقادير كاملة، ثم خطوات التحضير مرقمة وباختصار.'
    ).then((recipe) => {
        output.innerText = recipe || 'تعذر الحصول على الوصفة، حاول مجدداً.';
    }).catch(() => {
        output.innerText = 'خدمة الذكاء الاصطناعي غير متاحة على هذا الجهاز، تأكد من الاتصال بالإنترنت وحاول مجدداً.';
    });
}

function showSubstitutes() {
    const input = document.getElementById('ingredientsInput');
    const output = document.getElementById('recipeOutput');
    const ingredients = input ? input.value.trim() : '';

    if (!ingredients) {
        showNotification('أدخل المكونات أولاً');
        return;
    }

    lastSuggestedIngredients = ingredients;
    output.innerText = 'جاري البحث عن البدائل...';

    callAI(
        'أنت طاهٍ محترف. لدي هذه المكونات: ' + ingredients + '\n' +
        'اكتب بالعربية وباختصار: بدائل منزلية شائعة لأهم المكونات الناقصة في الوصفات، ' +
        'ثم اقترح 3 أطباق سريعة يمكن تحضيرها بهذه المكونات.'
    ).then((subs) => {
        output.innerText = subs || 'تعذر الحصول على البدائل، حاول مجدداً.';
    }).catch(() => {
        output.innerText = 'خدمة الذكاء الاصطناعي غير متاحة على هذا الجهاز، تأكد من الاتصال بالإنترنت وحاول مجدداً.';
    });
}
document.addEventListener("DOMContentLoaded", function () {
  const currentYear = new Date().getFullYear();
  document.getElementById("year").textContent = currentYear;
});
