// Sostituisci questo URL con l'URL della tua Web App di Google Apps Script (assicurati finisca con /exec)
const API_URL = window.IDROCLIMA_RELEASE?.apiUrl || 'https://script.google.com/macros/s/AKfycbx38nGmf0QzZz8AjDrCgljgXjmXA5ZHPIB50quq6M_rh5qCypdJ9lvqkyKVrXF804St/exec';

// Elementi DOM
const loginScreen = document.getElementById('login-screen');
const homeScreen = document.getElementById('home-screen');
const loginForm = document.getElementById('login-form');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const btnLogin = document.getElementById('btn-login');
const loginText = document.getElementById('login-text');
const loginSpinner = document.getElementById('login-spinner');
const loginError = document.getElementById('login-error');
const btnInstall = document.getElementById('btn-install');
const btnLogout = document.getElementById('btn-logout');
const userGreeting = document.getElementById('user-greeting');
const appsContainer = document.getElementById('apps-container');
const loadingApps = document.getElementById('loading-apps');

// Elementi iFrame
const iframeScreen = document.getElementById('iframe-screen');
const appIframe = document.getElementById('app-iframe');
const iframeTitle = document.getElementById('iframe-title');
const btnCloseIframe = document.getElementById('btn-close-iframe');

// Scanner CURIT eseguito nel documento PWA di primo livello: evita i limiti
// della fotocamera negli iframe HtmlService e restituisce il risultato al
// Cruscotto Tecnico tramite postMessage.
const curitScanner = {
    overlay: document.getElementById('curit-scanner-overlay'),
    video: document.getElementById('curit-scanner-video'),
    canvas: document.getElementById('curit-scanner-canvas'),
    status: document.getElementById('curit-scanner-status'),
    manual: document.getElementById('curit-scanner-manual'),
    photo: document.getElementById('curit-scanner-photo'),
    stream: null,
    running: false,
    requester: null,
    lastDecodeAt: 0,
    nativeDetector: null,
    frameBusy: false
};

window.addEventListener('message', event => {
    if (!event.data || !['IDROCLIMA_CURIT_SCAN_REQUEST','IDROCLIMA_CURIT_VERIFY_REQUEST'].includes(event.data.type)) return;
    curitScanner.requester = event.source;
    if (event.data.type === 'IDROCLIMA_CURIT_VERIFY_REQUEST') {
        const tag = extractCuritTag(event.data.targa || '');
        curitScanner.overlay?.classList.remove('hidden');
        if (curitScanner.manual) curitScanner.manual.value = tag || String(event.data.targa || '');
        if (!tag) return sendCuritResultToRequester_({ok:false,status:'FORMATO_NON_VALIDO',message:'Targa CURIT non valida.'});
        setCuritScannerStatus(`Verifica CURIT ${tag}…`);
        verifyCuritTag(tag);
        return;
    }
    openCuritScanner();
});

document.getElementById('curit-scanner-close')?.addEventListener('click', closeCuritScanner);
document.getElementById('curit-scanner-photo-button')?.addEventListener('click', openCuritCameraPhoto);
curitScanner.photo?.addEventListener('change', decodeCuritPhoto);
document.getElementById('curit-scanner-verify')?.addEventListener('click', () => {
    const tag = extractCuritTag(curitScanner.manual?.value || '');
    if (!tag) return setCuritScannerStatus('Targa non valida: servono 16 caratteri alfanumerici.');
    verifyCuritTag(tag);
});

async function openCuritScanner() {
    curitScanner.overlay?.classList.remove('hidden');
    setCuritScannerStatus('Avvio fotocamera…');
    try {
        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('Fotocamera continua non disponibile');
        try {
            curitScanner.stream = await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});
        } catch (_) {
            curitScanner.stream = await navigator.mediaDevices.getUserMedia({video:true,audio:false});
        }
        curitScanner.video.srcObject = curitScanner.stream;
        await curitScanner.video.play();
        curitScanner.running = true;
        setCuritScannerStatus('Inquadra il QR della targa CURIT.');
        requestAnimationFrame(scanCuritFrame);
    } catch (error) {
        setCuritScannerStatus('Scansione continua non disponibile. Tocca “Fotografa il QR” oppure inserisci la targa manualmente.');
    }
}

function openCuritCameraPhoto() {
    if (!curitScanner.photo) return setCuritScannerStatus('Fotocamera non disponibile. Inserisci manualmente la targa.');
    curitScanner.photo.value = '';
    curitScanner.photo.click();
}

async function curitImageSourceFromFile(file) {
    if ('createImageBitmap' in window) {
        try { return await createImageBitmap(file); } catch (_) {}
    }
    return await new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file), image = new Image();
        image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
        image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Immagine non leggibile.')); };
        image.src = url;
    });
}

async function decodeCuritPhoto(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    setCuritScannerStatus('Lettura del QR dalla fotografia…');
    try {
        const bitmap = await curitImageSourceFromFile(file);
        const sourceWidth = bitmap.width || bitmap.naturalWidth, sourceHeight = bitmap.height || bitmap.naturalHeight;
        const canvas = curitScanner.canvas, maxSide = 1800, scale = Math.min(1, maxSide / Math.max(sourceWidth, sourceHeight));
        canvas.width = Math.max(1, Math.round(sourceWidth * scale));
        canvas.height = Math.max(1, Math.round(sourceHeight * scale));
        const ctx = canvas.getContext('2d', {willReadFrequently:true});
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        bitmap.close?.();
        let raw = '';
        if ('BarcodeDetector' in window) {
            try {
                const found = await new BarcodeDetector({formats:['qr_code']}).detect(canvas);
                if (found.length) raw = found[0].rawValue || '';
            } catch (_) {}
        }
        if (!raw && window.jsQR) {
            const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const decoded = window.jsQR(image.data, image.width, image.height, {inversionAttempts:'attemptBoth'});
            if (decoded) raw = decoded.data || '';
        }
        const tag = extractCuritTag(raw);
        if (!tag) throw new Error('QR CURIT non riconosciuto. Riprova evitando riflessi e includendo tutto il codice.');
        verifyCuritTag(tag);
    } catch (error) {
        setCuritScannerStatus(error && error.message ? error.message : 'Impossibile leggere la fotografia.');
    }
}

function closeCuritScanner() {
    curitScanner.running = false;
    if (curitScanner.stream) curitScanner.stream.getTracks().forEach(track => track.stop());
    curitScanner.stream = null;
    if (curitScanner.video) curitScanner.video.srcObject = null;
    curitScanner.overlay?.classList.add('hidden');
}

function stopCuritCameraStream() {
    curitScanner.running = false;
    if (curitScanner.stream) curitScanner.stream.getTracks().forEach(track => track.stop());
    curitScanner.stream = null;
    if (curitScanner.video) curitScanner.video.srcObject = null;
}

async function scanCuritFrame(timestamp) {
    if (!curitScanner.running) return;
    if (!curitScanner.frameBusy && timestamp - curitScanner.lastDecodeAt > 180 && curitScanner.video.readyState >= 2) {
        curitScanner.frameBusy = true;
        curitScanner.lastDecodeAt = timestamp;
        const canvas = curitScanner.canvas, video = curitScanner.video;
        const maxWidth = 1280, scale = Math.min(1, maxWidth / video.videoWidth);
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
        const ctx = canvas.getContext('2d', {willReadFrequently:true});
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        try {
            let raw = '';
            if ('BarcodeDetector' in window) {
                try {
                    curitScanner.nativeDetector = curitScanner.nativeDetector || new BarcodeDetector({formats:['qr_code']});
                    const found = await curitScanner.nativeDetector.detect(canvas);
                    if (found.length) raw = found[0].rawValue || '';
                } catch (_) {}
            }
            if (!raw && window.jsQR) {
                const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const decoded = window.jsQR(image.data, image.width, image.height, {inversionAttempts:'attemptBoth'});
                if (decoded) raw = decoded.data || '';
            }
            const tag = extractCuritTag(raw);
            if (tag) {
                stopCuritCameraStream();
                if (curitScanner.manual) curitScanner.manual.value = tag;
                setCuritScannerStatus(`QR letto: ${tag}. Verifica automatica…`);
                if (navigator.vibrate) navigator.vibrate(120);
                verifyCuritTag(tag);
                return;
            }
        } catch (_) {}
        finally { curitScanner.frameBusy = false; }
    }
    requestAnimationFrame(scanCuritFrame);
}

function extractCuritTag(value) {
    const text = String(value || '').trim().toUpperCase();
    let match = text.match(/[?&]TARGA=([A-Z0-9]{16})(?:&|$)/i);
    if (match) return match[1].toUpperCase();
    match = text.match(/\b[A-Z0-9]{16}\b/);
    return match ? match[0] : '';
}

function setCuritScannerStatus(message) {
    if (curitScanner.status) curitScanner.status.textContent = message;
}

function sendCuritResultToRequester_(result) {
    const target = curitScanner.requester || (appIframe && appIframe.contentWindow);
    if (target) target.postMessage({type:'IDROCLIMA_CURIT_SCAN_RESULT', result}, '*');
}

function verifyCuritTag(tag) {
    const canonical = extractCuritTag(tag);
    if (!canonical) return setCuritScannerStatus('Targa CURIT non valida.');
    closeCuritScanner();
    sendCuritResultToRequester_({ok:true,decodedOnly:true,targa:canonical,checkedAt:new Date().toISOString()});
}

// Elementi Admin
const adminScreen = document.getElementById('admin-screen');
const btnAdminBack = document.getElementById('btn-admin-back');
const btnAdminSave = document.getElementById('btn-admin-save');
const btnAddUser = document.getElementById('btn-add-user');
const btnAddApp = document.getElementById('btn-add-app');
const btnAddGroup = document.getElementById('btn-add-group');
const adminLoading = document.getElementById('admin-loading');
const adminContent = document.getElementById('admin-content');
const transitionOverlay = document.getElementById('transition-overlay');
const transitionIconContainer = document.getElementById('transition-icon-container');

// State
let currentUser = null;
let adminData = null; // { utenti, profili, apps, permessi }

// Registrazione Service Worker per PWA e Caching PWA Install
let deferredPrompt;

// Aiuto per Installazione iOS (Apple Safari)
const isIos = () => {
    const userAgent = window.navigator.userAgent.toLowerCase();
    const iPadOsDesktopMode = userAgent.includes('macintosh') && navigator.maxTouchPoints > 1;
    return /iphone|ipad|ipod/.test(userAgent) || iPadOsDesktopMode;
};
const isMobileBrowser = () => /android|iphone|ipad|ipod/i.test(window.navigator.userAgent) || navigator.maxTouchPoints > 1;
const isInStandaloneMode = () => window.matchMedia('(display-mode: standalone)').matches || (('standalone' in window.navigator) && window.navigator.standalone);

if (btnInstall && isMobileBrowser() && !isInStandaloneMode()) {
    btnInstall.classList.remove('hidden');
    btnInstall.innerHTML = isIos()
        ? '<i class="fa-brands fa-apple"></i> Setup su iPhone/iPad'
        : '<i class="fa-solid fa-download"></i> Installa App';
}

window.addEventListener('beforeinstallprompt', (e) => {
    // Previeni apparizione banner automatico
    e.preventDefault();
    deferredPrompt = e;
    // Mostra il pulsante di installazione (ambiente Android/PC)
    if (btnInstall) btnInstall.classList.remove('hidden');
});

btnInstall.addEventListener('click', async () => {
    // Seleziona comportamento Apple
    if (isIos() && !isInStandaloneMode()) {
        alert("PER INSTALLARE SU APPLE iOS:\n\n1. Tocca l'icona 'Condividi' (il quadrato con la freccia rivolta in alto) nella barra inferiore di Safari.\n2. Scorri il menÃ¹ e tocca 'Aggiungi alla schermata Home' o 'Aggiungi a Home'.");
        return;
    }

    if (deferredPrompt) {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        deferredPrompt = null;
        btnInstall.classList.add('hidden');
    } else if (!isIos()) {
        alert("Per installare l'app:\n\n1. Apri il menu del browser.\n2. Tocca 'Installa app' oppure 'Aggiungi a schermata Home'.\n\nSe il pulsante non compare nel menu, ricarica la pagina dopo qualche secondo.");
    }
});

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js')
            .then(reg => {
                reg.update();
            })
            .catch(err => console.error('Errore Service Worker', err));
    });
}

// Inizializzazione
function init() {
    // Controlla se c'Ã¨ una sessione salvata
    const session = localStorage.getItem('portale_procedure_rc1_session');
    if (session) {
        try { currentUser = JSON.parse(session); } catch(e) { currentUser = null; }
        if (currentUser && currentUser.sessionToken) showHomeScreen();
        else { localStorage.removeItem('portale_procedure_rc1_session'); currentUser = null; showLoginScreen(); }
    } else {
        showLoginScreen();
    }
}

// UI Navigazione
function showLoginScreen() {
    homeScreen.classList.add('hidden');
    loginScreen.classList.remove('hidden');
    loginError.classList.add('hidden');
    usernameInput.value = '';
    passwordInput.value = '';
}

async function showHomeScreen(accessVerified = false) {
    // GET_USER_DATA performs the server check too: restore needs only one request.
    loginScreen.classList.add('hidden');
    homeScreen.classList.remove('hidden');
    userGreeting.textContent = `Ciao, ${currentUser.nome}`;
    loadApps();
}

function hideHomeForFullscreenView() {
    document.body.classList.add('fullscreen-active');
    homeScreen.classList.add('hidden');
}

function restoreHomeAfterFullscreenView() {
    const fullscreenViewsClosed =
        iframeScreen.classList.contains('hidden') &&
        document.getElementById('drive-viewer-screen').classList.contains('hidden') &&
        document.getElementById('timbrature-screen').classList.contains('hidden') &&
        adminScreen.classList.contains('hidden');

    if (currentUser && loginScreen.classList.contains('hidden') && fullscreenViewsClosed) {
        document.body.classList.remove('fullscreen-active');
        homeScreen.classList.remove('hidden');
    } else if (fullscreenViewsClosed) {
        document.body.classList.remove('fullscreen-active');
    }
}

function setLoading(isLoading) {
    if (isLoading) {
        loginText.classList.add('hidden');
        loginSpinner.classList.remove('hidden');
        btnLogin.disabled = true;
    } else {
        loginText.classList.remove('hidden');
        loginSpinner.classList.add('hidden');
        btnLogin.disabled = false;
    }
}

// Gestione Login
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.classList.add('hidden');
    setLoading(true);

    const username = usernameInput.value.trim();
    const password = passwordInput.value.trim();

    try {
        const response = await authenticatedFetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({
                action: 'LOGIN',
                username: username,
                password: password
            })
        });

        const data = await response.json();

        if (data.status === 'success') {
            // Salva sessione in localStorage
            if (!data.token) throw new Error('Backend non aggiornato: sessione mancante.');
            currentUser = {...data.user, sessionToken:data.token};
            markAccessValidated(currentUser.sessionToken);
            localStorage.setItem('portale_procedure_rc1_session', JSON.stringify(currentUser));
            await showHomeScreen(true);
        } else {
            loginError.textContent = data.message || "Credenziali errate.";
            loginError.classList.remove('hidden');
        }
    } catch (error) {
        console.error("Errore login:", error);
        loginError.textContent = "Errore di rete. Verifica la connessione.";
        loginError.classList.remove('hidden');
    } finally {
        setLoading(false);
    }
});

btnLogout.addEventListener('click', () => {
    localStorage.removeItem('portale_procedure_rc1_session');
    currentUser = null;
    closeProtectedScreens();
    showLoginScreen();
});

// Caricamento App
async function loadApps() {
    appsContainer.innerHTML = '';
    loadingApps.classList.remove('hidden');

    try {
        const response = await authenticatedFetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({
                action: 'GET_USER_DATA',
                userId: currentUser.id || currentUser.ID_UTENTE
            })
        });

        const data = await response.json();

        if (data.status === 'success') {
            renderApps(data.apps);
        } else {
            if (currentUser) showConnectionStatus(data.message || 'Impossibile caricare le app. Riprova.');

        }
    } catch (error) {
        console.error("Errore fetch app:", error);
        if (currentUser) showConnectionStatus('Connessione momentaneamente non disponibile. Il tuo accesso è conservato. Riprova.');
    } finally {
        loadingApps.classList.add('hidden');
    }
}

function renderApps(apps) {
    if (apps.length === 0) {
        appsContainer.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: var(--text-muted);">Nessuna applicazione disponibile.</p>';
    }

    apps.forEach(app => {
        if (!app.isAllowed) return; // L'admin ha chiesto di nasconderle completamente

        const card = document.createElement('a');
        card.className = 'app-card';
        card.href = '#';

        if (app.isAllowed) {
            card.onclick = async (e) => {
                e.preventDefault();
                runAppTransition(card, async () => {
                if (!await validateCurrentAccess()) return false;
                // PROCEDURES ADDITION — single-use identity ticket for the new Cruscotto.
                const targetUrl = window.IdroclimaPrepareTechnicalLink ? await window.IdroclimaPrepareTechnicalLink(app.id,app.link) : app.link;
                const targetName = app.nome;

                authenticatedFetch(API_URL, {
                    method: 'POST',
                    body: JSON.stringify({
                        action: 'LOG_APP_OPEN',
                        userId: currentUser.id || currentUser.ID_UTENTE,
                        userName: currentUser.nome || currentUser.NOME,
                        appId: app.id,
                        appName: app.nome
                    })
                }).catch(e => console.error("Log error", e));

                if (isIos() && !targetUrl.startsWith('native://')) {
                    // Bypass specifico per iOS: evitiamo iframe a causa del blocco cookie di terze parti (ITP).
                    // Utilizziamo window.location.href per aprire nel Safari View Controller (in PWA) 
                    // o nella stessa scheda senza subire blocchi di popup.
                    window.location.href = targetUrl;
                    return;
                }


                    if (targetUrl === 'native://timbrature') {
                        openTimbratureNative();
                    } else if (targetUrl === 'native://procedure') {
                        openDriveViewerNative('procedure', targetName);
                    } else if (targetUrl === 'native://comunicazioni') {
                        openDriveViewerNative('comunicazioni', targetName);
                    } else if (targetUrl === 'native://modulirapidi') {
                        openModuliRapidiNative();
                    } else {
                        openAppInIframe(targetName, targetUrl, app.id);
                    }
                });
            };
        } else {
            card.onclick = (e) => {
                e.preventDefault();
                alert(`Accesso non abilitato al profilo '${currentUser.profilo}' per questa App.`);
            };
        }

        const iconClass = app.icona ? app.icona : 'fa-folder';
        const iconColor = app.colore ? app.colore : 'var(--primary-color)';

        let isImage = false;
        const iconLower = iconClass.toLowerCase();
        if (iconLower.startsWith('http') || iconLower.startsWith('data:img') || iconLower.startsWith('data:image') || iconLower.includes('.png') || iconLower.includes('.jpg') || iconLower.includes('.jpeg') || iconLower.includes('.svg') || iconLower.includes('.webp')) {
            isImage = true;
        }

        if (isImage) {
            let src = iconClass;
            if (!src.startsWith('http') && !src.startsWith('data:')) {
                src = `Prismi & Icone/${iconClass}`;
            }

            card.innerHTML = `
                <img src="${src}" style="width: 85px; height: 85px; object-fit: contain; filter: drop-shadow(0 4px 8px rgba(0,0,0,0.5)); margin-bottom: 5px;" alt="${app.nome}">
                <div class="app-title">${app.nome}</div>
                ${!app.isAllowed ? '<div class="app-badge"><i class="fa-solid fa-lock"></i></div>' : ''}
            `;
        } else {
            let iconContent = `<i class="${iconClass.includes('fa-') ? 'fa-solid ' + iconClass : 'fa-solid fa-folder'}"></i>`;
            card.innerHTML = `
                <div class="app-icon" style="background-color: ${iconColor};">
                    ${iconContent}
                </div>
                <div class="app-title">${app.nome}</div>
                ${!app.isAllowed ? '<div class="app-badge"><i class="fa-solid fa-lock"></i></div>' : ''}
            `;
        }

        bindAppTap(card);
        appsContainer.appendChild(card);
    });

    // Se admin, aggiungi card per config
    if (currentUser.isAdmin === true || currentUser.isAdmin === 'TRUE' || currentUser.isAdmin === 'Vero') {
        const adminCard = document.createElement('a');
        adminCard.className = 'app-card';
        adminCard.href = '#';
        adminCard.onclick = (e) => {
            e.preventDefault();
            runAppTransition(adminCard, () => {
                showAdminScreen();
            });
        };
        adminCard.innerHTML = `
            <div class="app-icon" style="background-color: #10b981;">
                <i class="fa-solid fa-user-shield"></i>
            </div>
            <div class="app-title">Area Admin</div>
        `;
        bindAppTap(adminCard);
        appsContainer.appendChild(adminCard);
    }
}

function bindAppTap(card) {
    let start=null,lastTouch=0;
    const open=card.onclick;
    card.addEventListener('pointerdown',event=>{
        if(event.pointerType==='touch')start={x:event.clientX,y:event.clientY};
    });
    card.addEventListener('pointercancel',()=>start=null);
    card.addEventListener('pointerup',event=>{
        const first=start;start=null;
        if(event.pointerType!=='touch'||!first||Math.hypot(event.clientX-first.x,event.clientY-first.y)>12)return;
        event.preventDefault();lastTouch=Date.now();open(event);
    });
    card.onclick=event=>{if(Date.now()-lastTouch<700){event.preventDefault();return;}return open(event);};
}

// Logica Transizione Premium
let appTransitionRunning = false;
async function runAppTransition(sourceElement, callback) {
    if (appTransitionRunning) return;
    const icon = sourceElement.querySelector('img') || sourceElement.querySelector('.app-icon');
    if (!icon) return callback();
    appTransitionRunning = true;
    const rect = icon.getBoundingClientRect(), clone = icon.cloneNode(true);
    const bgColor = window.getComputedStyle(icon).backgroundColor;
    Object.assign(clone.style,{margin:'0',position:'fixed',top:rect.top+'px',left:rect.left+'px',width:rect.width+'px',height:rect.height+'px'});
    if (icon.classList.contains('app-icon')) clone.style.backgroundColor=bgColor;
    clone.classList.add('transition-clone');document.body.appendChild(clone);
    transitionOverlay.classList.remove('hidden');
    const timers=[];
    const later=(fn,ms)=>timers.push(setTimeout(fn,ms));
    later(()=>transitionOverlay.classList.add('active'),10);
    later(()=>clone.classList.add('moving'),50);
    later(()=>clone.classList.add('spinning'),850);
    later(()=>clone.classList.add('zooming'),2100);
    const animationDone=new Promise(resolve=>later(resolve,3200));
    const cleanup=()=>{
        timers.forEach(clearTimeout);
        transitionOverlay.classList.remove('active');
        setTimeout(()=>{transitionOverlay.classList.add('hidden');clone.remove();appTransitionRunning=false;},600);
    };
    try {
        // Start server checks and app loading now, under the original animation.
        const result = await callback();
        if (result !== false) await animationDone;
    } catch(error) {console.error('Apertura app:',error);}
    finally {cleanup();}
}

// Logica Apertura App in iFrame
function openAppInIframe(nome, url, appId = '') {
    document.body.style.overflow = 'hidden';
    hideHomeForFullscreenView();
    iframeTitle.textContent = nome;
    iframeScreen.classList.remove('hidden');
    iframeScreen.style.width = '100vw';
    iframeScreen.style.height = '100dvh';
    iframeScreen.style.position = 'fixed';
    iframeScreen.style.inset = '0';
    iframeScreen.style.overflow = 'hidden';

    const iframeContainer = document.getElementById('iframe-container');
    if (iframeContainer) {
        iframeContainer.style.width = '100vw';
        iframeContainer.style.height = '100dvh';
        iframeContainer.style.maxWidth = '100vw';
        iframeContainer.style.maxHeight = '100dvh';
        iframeContainer.style.overflow = 'hidden';
    }

    const wrapper = appIframe.parentElement;
    wrapper.style.overflow = 'hidden';
    wrapper.style.position = 'relative';
    wrapper.style.webkitOverflowScrolling = 'touch';
    wrapper.style.width = '100%';
    wrapper.style.height = '100%';
    wrapper.style.minWidth = '0';

    appIframe.style.position = 'absolute';
    appIframe.style.top = '0';
    appIframe.style.left = '0';
    appIframe.style.border = '0';
    appIframe.style.outline = '0';
    appIframe.style.margin = '0';
    appIframe.style.padding = '0';
    appIframe.style.display = 'block';
    appIframe.style.boxSizing = 'border-box';
    appIframe.style.background = 'transparent';
    appIframe.style.transformOrigin = '0 0';

    appIframe.style.width = '100%';
    appIframe.style.height = '100%';
    appIframe.style.minWidth = '0';
    appIframe.style.maxWidth = '100%';
    appIframe.style.transform = 'none';
    appIframe.style.zoom = '1';
    appIframe.setAttribute('scrolling', 'yes');

    appIframe.src = url;
}

btnCloseIframe.addEventListener('click', () => {
    iframeScreen.classList.add('hidden');
    appIframe.src = ''; // Svuota per fermare processi in background
    iframeScreen.style.zIndex = ''; // Ripristina z-index se modificato

    // Ripristina lo scroll solo se non ci sono altre modali full-screen attive
    if (document.getElementById('drive-viewer-screen').classList.contains('hidden') &&
        document.getElementById('timbrature-screen').classList.contains('hidden') &&
        document.getElementById('admin-screen').classList.contains('hidden')) {
        document.body.style.overflow = '';
    } else {
        document.body.style.overflow = 'hidden';
    }
    restoreHomeAfterFullscreenView();
});

// ================= TIMBRATURE NATIVE LOGIC =================

const timbratureScreen = document.getElementById('timbrature-screen');
const btnCloseTimbrature = document.getElementById('btn-close-timbrature');
const timbratureLoading = document.getElementById('timbrature-loading');
const timbratureResult = document.getElementById('timbrature-body');
const timbratureError = document.getElementById('timbrature-error');

function openTimbratureNative() {
    document.body.style.overflow = 'hidden';
    hideHomeForFullscreenView();
    timbratureScreen.classList.remove('hidden');
    timbratureLoading.classList.remove('hidden');
    timbratureError.classList.add('hidden');
    timbratureError.textContent = '';
    timbratureResult.classList.add('hidden');
    timbratureResult.innerHTML = '';

    fetchMyTimbrature();
}

if (btnCloseTimbrature) {
    btnCloseTimbrature.addEventListener('click', () => {
        document.body.style.overflow = '';
        timbratureScreen.classList.add('hidden');
        restoreHomeAfterFullscreenView();
    });
}

async function fetchMyTimbrature() {
    try {
        const response = await authenticatedFetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({
                action: 'GET_MY_TIMBRATURE',
                nome: currentUser.nome
            })
        });

        const data = await response.json();

        if (data.status === 'success') {
            renderTimbrature(data);
        } else {
            timbratureError.textContent = data.message || 'Errore nel recupero delle timbrature.';
            timbratureLoading.classList.add('hidden');
            timbratureError.classList.remove('hidden');
        }
    } catch (error) {
        timbratureError.textContent = 'Errore di rete. Impossibile connettersi al server.';
        timbratureLoading.classList.add('hidden');
        timbratureError.classList.remove('hidden');
    }
}

function renderTimbrature(data) {
    const tableHTML = `
        <h3 style="color:white; margin-bottom: 5px;">Mese: ${data.mese}/${data.anno}</h3>
        <p style="color:var(--primary-color); font-weight: 600; margin-bottom: 15px;">Persona: ${data.nome}</p>
        <div class="table-responsive">
            <table class="admin-table">
                <thead>
                    <tr>
                        <th style="width: 60px;">Data</th>
                        <th>Timbrature</th>
                        <th style="width: 70px;">Pausa</th>
                    </tr>
                </thead>
                <tbody>
                    ${data.giorni.map(g => {
        let pausaLabel = '-';
        if (g.stamps.length > 0) {
            if (g.pauseMin === 60) pausaLabel = '1h';
            else if (g.pauseMin > 0) pausaLabel = g.pauseMin + ' min';
            else pausaLabel = '0 min';

            if (g.pauseType === 'timbrata') {
                pausaLabel += ' <small style="display:block; font-size:10px; color:#10b981;">(Timbrata)</small>';
            } else {
                pausaLabel += ' <small style="display:block; font-size:10px; color:#94a3b8;">(Offset)</small>';
            }
        }

        let stampsLabel = '-';
        if (g.stamps.length > 0) {
            if (g.stamps.length === 1) {
                stampsLabel = `Ing: <span style="color:#10b981;">${g.stamps[0]}</span>`;
            } else if (g.stamps.length >= 2) {
                let ing = g.stamps[0];
                let usc = g.stamps[g.stamps.length - 1];
                stampsLabel = `<div style="display:flex; flex-direction:column; gap:2px;">
                                    <div>Ing: <span style="color:#10b981;">${ing}</span> | Usc: <span style="color:#ef4444;">${usc}</span></div>
                                </div>`;
            }
            if (g.stamps.length > 2) {
                stampsLabel += `<div style="font-size:10px; color:var(--text-muted); margin-top:2px;">Tutte: ${g.stamps.join(' - ')}</div>`;
            }
        }

        return `
                        <tr>
                            <td><strong>${g.key.split('/')[0]}/${g.key.split('/')[1]}</strong></td>
                            <td style="font-family:monospace; font-size:13px; color: white;">
                                ${stampsLabel}
                            </td>
                            <td style="font-size: 13px; color: #f59e0b;">${pausaLabel}</td>
                        </tr>
                        `;
    }).join('')}
                </tbody>
            </table>
        </div>
    `;

    timbratureResult.innerHTML = tableHTML;
    timbratureLoading.classList.add('hidden');
    timbratureResult.classList.remove('hidden');
}

// ================= ADMIN DASHBOARD LOGIC =================

function showAdminScreen() {
    hideHomeForFullscreenView();
    homeScreen.classList.add('hidden');
    adminScreen.classList.remove('hidden');
    loadAdminData();
}

btnAdminBack.addEventListener('click', () => {
    if (adminDirty && !confirm('Hai modifiche non salvate. Vuoi uscire e scartarle?')) return;
    setAdminDirty(false);
    adminScreen.classList.add('hidden');
    document.body.classList.remove('fullscreen-active');
    homeScreen.classList.remove('hidden');
    loadApps(); // ricarica le app nel caso i permessi siano cambiati
});

const btnSharePortal = document.getElementById('btn-share-portal');
if (btnSharePortal) {
    btnSharePortal.addEventListener('click', () => {
        // Pulisce l'URL (elimina eventuali '?hash' o query vecchie) ma mantiene l'URL base
        const urlToShare = window.location.origin + window.location.pathname;
        navigator.clipboard.writeText(urlToShare).then(() => {
            const originalHTML = btnSharePortal.innerHTML;
            btnSharePortal.innerHTML = '<i class="fa-solid fa-check"></i> Copiato!';
            btnSharePortal.style.background = '#10b981';
            btnSharePortal.style.borderColor = '#10b981';
            btnSharePortal.style.color = '#fff';
            setTimeout(() => {
                btnSharePortal.innerHTML = originalHTML;
                btnSharePortal.style.background = '';
                btnSharePortal.style.borderColor = '';
                btnSharePortal.style.color = '';
            }, 2000);
        }).catch(err => {
            alert("Errore durante la copia del link: " + err);
        });
    });
}

async function loadAdminData() {
    adminLoading.classList.remove('hidden');
    adminContent.classList.add('hidden');

    try {
        const response = await authenticatedFetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({
                action: 'GET_ADMIN_DATA',
                adminUserId: currentUser.id || currentUser.ID_UTENTE,
                profile: currentUser.profilo
            })
        });
        const data = await response.json();

        if (data.status === 'success') {
            adminData = {
                utenti: data.utenti,
                profili: data.profili,
                apps: data.apps,
                permessi: data.permessi,
                dipendentiDisponibili: data.dipendentiDisponibili || [],
                revision: data.revision,
                log_accessi: data.log_accessi || []
            };
            groupPerms = {};
            setAdminDirty(false);
            renderAdminDashboard();
        } else {
            alert("Errore Admin: " + data.message);
            btnAdminBack.click();
        }
    } catch (e) {
        alert("Errore caricamento dati admin.");
        btnAdminBack.click();
    } finally {
        adminLoading.classList.add('hidden');
        adminContent.classList.remove('hidden');
    }
}

function renderAdminDashboard() {
    renderMonitoraggio();
    renderUtenti();
    renderAppsAdmin();
    renderGruppi();
    renderPermessi();

}

function renderMonitoraggio() {
    const container = document.getElementById('monitoraggio-container');
    if (!container) return;
    container.innerHTML = '';

    if (!adminData.log_accessi || adminData.log_accessi.length === 0) {
        container.innerHTML = '<p style="color:var(--text-muted); font-size:14px; text-align:center;">Nessun dato negli ultimi 30 giorni.</p>';
        return;
    }

    adminData.log_accessi.forEach(log => {
        let card = document.createElement('div');
        card.className = 'admin-card';
        
        let header = document.createElement('div');
        header.className = 'admin-card-header';
        header.innerHTML = `<span><i class="fa-solid fa-chart-line"></i> ${adminEscape(log.app)}</span> <span class="badge-mid" style="background:var(--primary-color);">${log.accessi.reduce((a,b)=>a+b.conteggio, 0)} view</span>`;
        card.appendChild(header);

        let body = document.createElement('div');
        body.className = 'admin-card-body';
        
        log.accessi.forEach(u => {
            body.innerHTML += `
                <div class="admin-log-row">
                    <span><i class="fa-solid fa-user-check" style="color:var(--text-muted);"></i> ${adminEscape(u.utente)}</span>
                    <strong style="color:var(--text-main);">${u.conteggio}</strong>
                </div>
            `;
        });
        
        card.appendChild(body);
        container.appendChild(card);
    });
    compactAdminCards('monitoraggio-container');
}

function renderUtenti() {
    // Genera datalist per nomi dipendenti disponibili
    if (!document.getElementById('nomi-dipendenti')) {
        const datalist = document.createElement('datalist');
        datalist.id = 'nomi-dipendenti';
        document.body.appendChild(datalist);
    }
    const dlNomi = document.getElementById('nomi-dipendenti');
    dlNomi.innerHTML = '';
    if (adminData.dipendentiDisponibili) {
        adminData.dipendentiDisponibili.forEach(nome => {
            const option = document.createElement('option');
            option.value = nome;
            dlNomi.appendChild(option);
        });
    }

    const container = document.getElementById('utenti-container');
    if (!container) return;
    container.innerHTML = '';
    adminData.utenti.forEach((u, i) => {
        let profiliOptions = adminData.profili.map(p =>
            `<option value="${adminEscape(p.ID_PROFILO)}" ${p.ID_PROFILO === u.PROFILO ? 'selected' : ''}>${adminEscape(p.ID_PROFILO)}</option>`
        ).join('');
        let isAttivo = adminYes(u.ORGANICO_ATTIVO === undefined ? u.ATTIVO : u.ORGANICO_ATTIVO);

        let card = document.createElement('div');
        card.className = 'admin-card';
        card.innerHTML = `
            <div class="admin-card-header">
                <span><i class="fa-solid fa-user"></i> ${adminEscape(u.NOME || 'Nuovo')} (${adminEscape(u.ID_UTENTE)})</span>
                <button class="btn-primary" onclick="resendEmployeeInvite(${i}, this)">Reinvia invito</button>
                <button class="btn-danger-small" onclick="removeUtente(${i})"><i class="fa-solid fa-trash"></i></button>
            </div>
            <div class="admin-card-body">
                <div class="admin-input-group">
                    <label>ID e Nome Dipendente</label>
                    <div style="display:flex; gap:10px;">
                        <input type="text" value="${adminEscape(u.ID_UTENTE)}" data-idx="${i}" data-field="ID_UTENTE" class="u-input" readonly style="flex:1" placeholder="ID">
                        <input type="text" list="nomi-dipendenti" value="${adminEscape(u.NOME)}" data-idx="${i}" data-field="NOME" class="u-input" style="flex:3" placeholder="Nome">
                    </div>
                </div>
                <div class="admin-input-group">
                    <label>Credenziali Accesso</label>
                    <div style="display:flex; gap:10px;">
                        <input type="text" value="${adminEscape(u.USERNAME)}" data-idx="${i}" data-field="USERNAME" class="u-input" placeholder="Username" style="flex:1">
                        <input type="text" value="${adminEscape(u.PASSWORD_HASH)}" data-idx="${i}" data-field="PASSWORD_HASH" class="u-input" placeholder="Password" style="flex:1">
                    </div>
                </div>
                <div class="admin-input-group">
                    <label>Gruppo di Permessi</label>
                    <select data-idx="${i}" data-field="PROFILO" class="u-input">${profiliOptions}</select>
                </div>
                <div class="admin-toggle-row">
                    <span>Presente nell’organico attivo</span>
                    <label class="toggle-switch">
                        <input type="checkbox" data-idx="${i}" data-field="ATTIVO" class="u-toggle" ${isAttivo ? 'checked' : ''}>
                        <span class="slider"></span>
                    </label>
                </div>
            </div>
        `;
        const body = card.querySelector('.admin-card-body');
        body.insertAdjacentHTML('beforeend', adminUserExtras(u,i));
        const name = card.querySelector('.admin-card-header > span');
        const status = adminYes(u.SOSPESO_INATTIVITA) ? 'Sospeso per timbrature' : !adminYes(u.ATTIVO) ? 'Accesso disattivato' : 'Accesso attivo';
        name.appendChild(Object.assign(document.createElement('small'),{textContent:status + (adminYes(u.ESCLUSO_CONTEGGI) ? ' · Escluso presenze' : adminYes(u.ESENTE_TIMBRATURA) ? ' · Esente timbrature' : '')}));
        container.appendChild(card);
    });
    compactAdminCards('utenti-container');

    // Aggiungi event listeners
    document.querySelectorAll('.u-input').forEach(el => el.addEventListener('change', updateUtenteData));
    document.querySelectorAll('.u-toggle').forEach(el => el.addEventListener('change', updateUtenteData));
}

function renderAppsAdmin() {
    // Genera la lista delle icone disponibili come menu a tendina/autocompletamento
    if (!document.getElementById('icone-list')) {
        const availableIcons = [
            "CF.png", "CFR.png", "CH.png", "CTR.png", "ICSR.png", "ICSSquare.png",
            "IP.png", "IPR.png", "IS.png", "ISR.png", "SC.png", "SCR.png", "SF.png", "SFR.png",
            "fa-solid fa-list", "fa-solid fa-folder", "fa-solid fa-wrench", "fa-solid fa-user", "fa-solid fa-chart-line"
        ];
        const datalist = document.createElement('datalist');
        datalist.id = 'icone-list';
        availableIcons.forEach(icon => {
            const option = document.createElement('option');
            option.value = icon;
            datalist.appendChild(option);
        });
        document.body.appendChild(datalist);
    }

    const container = document.getElementById('admin-apps-container');
    if (!container) return;
    container.innerHTML = '';
    
    adminData.apps.forEach((a, i) => {
        let isAttiva = (a.ATTIVA === true || a.ATTIVA === 'TRUE' || a.ATTIVA === 'Vero');
        let isVis = (a.VISIBILE_HOME === true || a.VISIBILE_HOME === 'TRUE' || a.VISIBILE_HOME === 'Vero');

        let card = document.createElement('div');
        card.className = 'admin-card';
        card.innerHTML = `
            <div class="admin-card-header">
                <span><i class="${String(a.ICONA || '').startsWith('fa-') ? a.ICONA : 'fa-solid fa-cube'}"></i> ${adminEscape(a.NOME_APP || 'Nuova App')} (${adminEscape(a.ID_APP)})</span>
                <button class="btn-danger-small" onclick="removeApp(${i})"><i class="fa-solid fa-trash"></i></button>
            </div>
            <div class="admin-card-body">
                <div class="admin-input-group">
                    <label>ID App e Nome Visualizzato</label>
                    <div style="display:flex; gap:10px;">
                        <input type="text" value="${adminEscape(a.ID_APP)}" data-idx="${i}" data-field="ID_APP" class="a-input" style="flex:1" placeholder="ID APP">
                        <input type="text" value="${adminEscape(a.NOME_APP)}" data-idx="${i}" data-field="NOME_APP" class="a-input" style="flex:2" placeholder="Nome Visualizzato">
                    </div>
                </div>
                <div class="admin-input-group">
                    <label>Link Deployment / Modulo Nativo</label>
                    <textarea data-idx="${i}" data-field="LINK_DEPLOYMENT" class="a-input" style="width:100%; height: 50px; resize: vertical; font-size: 11px; padding:8px; border-radius:6px; background:var(--input-bg); color:var(--text-main); border:1px solid var(--card-border);" placeholder="https://... o native://...">${adminEscape(a.LINK_DEPLOYMENT)}</textarea>
                    <select onchange="if(this.value) { const ta = this.previousElementSibling; ta.value = this.value; ta.dispatchEvent(new Event('change')); this.value=''; }" class="u-input" style="font-size:12px;">
                        <option value="">-- Autocompila Modulo Nativo --</option>
                        <option value="native://procedure">App Procedure</option>
                        <option value="native://comunicazioni">App Comunicazioni</option>
                        <option value="native://timbrature">App Timbrature</option>
                        <option value="native://modulirapidi">Moduli Rapidi</option>
                    </select>
                </div>
                <div class="admin-input-group">
                    <label>Icona e Ordine</label>
                    <div style="display:flex; gap:10px;">
                        <input type="text" list="icone-list" value="${adminEscape(a.ICONA)}" data-idx="${i}" data-field="ICONA" class="a-input" style="flex:2" placeholder="Icona">
                        <input type="number" value="${a.ORDINE || 99}" data-idx="${i}" data-field="ORDINE" class="a-input" style="flex:1" placeholder="Ordine">
                    </div>
                </div>
                <div class="admin-toggle-row">
                    <span>App Attiva nel sistema</span>
                    <label class="toggle-switch">
                        <input type="checkbox" data-idx="${i}" data-field="ATTIVA" class="a-toggle" ${isAttiva ? 'checked' : ''}>
                        <span class="slider"></span>
                    </label>
                </div>
                <div class="admin-toggle-row">
                    <span>Visibile in Homepage</span>
                    <label class="toggle-switch">
                        <input type="checkbox" data-idx="${i}" data-field="VISIBILE_HOME" class="a-toggle" ${isVis ? 'checked' : ''}>
                        <span class="slider"></span>
                    </label>
                </div>
            </div>
        `;
        container.appendChild(card);
    });

    compactAdminCards('admin-apps-container');
    document.querySelectorAll('.a-input').forEach(el => el.addEventListener('change', updateAppData));
    document.querySelectorAll('.a-toggle').forEach(el => el.addEventListener('change', updateAppData));
}

function renderGruppi() {
    const container = document.getElementById('gruppi-container');
    if (!container) return;
    container.innerHTML = '';
    adminData.profili.forEach((g, i) => {
        let card = document.createElement('div');
        card.className = 'admin-card';
        card.innerHTML = `
            <div class="admin-card-header">
                <span><i class="fa-solid fa-users-gear"></i> ${adminEscape(g.ID_PROFILO || 'Nuovo Gruppo')}</span>
                <button class="btn-danger-small" onclick="removeGruppo(${i})"><i class="fa-solid fa-trash"></i></button>
            </div>
            <div class="admin-card-body">
                <div class="admin-input-group">
                    <label>Nome Gruppo e Descrizione</label>
                    <div style="display:flex; gap:10px;">
                        <input type="text" value="${adminEscape(g.ID_PROFILO || '')}" data-idx="${i}" data-field="ID_PROFILO" class="g-input" style="flex:1" placeholder="NOME GRUPPO">
                        <input type="text" value="${adminEscape(g.DESCRIZIONE || '')}" data-idx="${i}" data-field="DESCRIZIONE" class="g-input" style="flex:2" placeholder="Descrizione">
                    </div>
                </div>
            </div>
        `;
        container.appendChild(card);
    });
    compactAdminCards('gruppi-container');
    document.querySelectorAll('.g-input').forEach(el => el.addEventListener('change', updateGruppoData));
}

function updateGruppoData(e) {
    let idx = e.target.getAttribute('data-idx');
    let field = e.target.getAttribute('data-field');
    const old = adminData.profili[idx][field];
    adminData.profili[idx][field] = e.target.value;
    if (field === 'ID_PROFILO') {
        adminData.utenti.filter(u => u.PROFILO === old).forEach(u => u.PROFILO = e.target.value);
        groupPerms[e.target.value] = groupPerms[old] || {}; delete groupPerms[old];
    }

    if (field === 'ID_PROFILO') { renderUtenti(); renderPermessi(); }
}

window.removeGruppo = function (idx) {
    if (adminData.utenti.some(u => u.PROFILO === adminData.profili[idx].ID_PROFILO)) {alert('Sposta prima gli utenti in un altro gruppo.');return;}
    if (confirm("Sei sicuro di eliminare questo gruppo?")) {
        adminData.profili.splice(idx, 1);
        setAdminDirty(true);
        renderGruppi();
        renderUtenti(); 
        renderPermessi();
    }
};

if (btnAddGroup) {
    btnAddGroup.addEventListener('click', () => {
        setAdminDirty(true);
        adminData.profili.push({
            ID_PROFILO: adminUnique('GRUPPO',adminData.profili,'ID_PROFILO'), DESCRIZIONE: 'Descrizione'
        });
        renderGruppi();
        openNewAdminCard('gruppi-container');
        renderUtenti();
        renderPermessi();
    });
}

function updateUtenteData(e) {
    let idx = e.target.getAttribute('data-idx');
    let field = e.target.getAttribute('data-field');
    (adminData.utenti[idx]._changedFields || (adminData.utenti[idx]._changedFields={}))[field]=true;
    if (field === 'ESCLUSO_CONTEGGI') adminData.utenti[idx]._exclusionChanged=true;
    if (field === 'ATTIVO') {adminData.utenti[idx].ORGANICO_ATTIVO = e.target.checked;adminData.utenti[idx]._activeChanged = true;}
    adminData.utenti[idx][field] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
}

function updateAppData(e) {
    let idx = parseInt(e.target.getAttribute('data-idx'));
    let field = e.target.getAttribute('data-field');
    let newValue = e.target.type === 'checkbox' ? e.target.checked : e.target.value;

    if (field === 'ORDINE') {
        newValue = parseInt(newValue);
        if (isNaN(newValue)) newValue = 99;
        let oldValue = parseInt(adminData.apps[idx][field] || 99);
        adminData.apps[idx][field] = newValue;

        adminData.apps.forEach((a, i) => {
            if (i !== idx) {
                let o = parseInt(a.ORDINE || 99);
                if (oldValue > newValue && o >= newValue && o < oldValue) {
                    a.ORDINE = o + 1;
                } else if (oldValue < newValue && o > oldValue && o <= newValue) {
                    a.ORDINE = o - 1;
                }
            }
        });

        adminData.apps.sort((a,b) => parseInt(a.ORDINE||99) - parseInt(b.ORDINE||99));
        adminData.apps.forEach((a, i) => a.ORDINE = i + 1);

        renderAppsAdmin();
        renderPermessi();
        return;
    }

    const oldId = adminData.apps[idx][field];
    adminData.apps[idx][field] = newValue;
    if (field === 'ID_APP') {
        adminData.permessi.filter(p => p.ID_APP === oldId).forEach(p => p.ID_APP = newValue);
        Object.values(groupPerms).forEach(g => {if (g[oldId] !== undefined) {g[newValue]=g[oldId];delete g[oldId];}});
    }

    // Se cambia un ID APP dobbiamo re-renderizzare i permessi (o se si disattiva/attiva, cambiano le colonne)
    if (field === 'ID_APP' || field === 'ATTIVA' || field === 'VISIBILE_HOME') {
        renderPermessi();
    }
}

window.removeUtente = function (idx) {
    if (confirm("Sei sicuro di eliminare questo utente? Verranno rimossi anche i suoi permessi specifici.")) {
        let utenteRemoved = adminData.utenti[idx];
        adminData.permessi = adminData.permessi.filter(p => p.ID_UTENTE !== utenteRemoved.ID_UTENTE);
        adminData.utenti.splice(idx, 1);
        setAdminDirty(true);
        renderUtenti();
        renderPermessi();
    }
};

window.removeApp = function (idx) {
    if (confirm("Sei sicuro di eliminare questa App? Verranno rimossi anche i relativi permessi.")) {
        let appRemoved = adminData.apps[idx];
        // Rimuovi anche i permessi orfani
        adminData.permessi = adminData.permessi.filter(p => p.ID_APP !== appRemoved.ID_APP);
        adminData.apps.splice(idx, 1);
        setAdminDirty(true);
        renderAppsAdmin();
        renderPermessi();
    }
};

if (btnAddUser) {
    btnAddUser.addEventListener('click', () => {
        setAdminDirty(true);
        let newId = adminUnique('U',adminData.utenti,'ID_UTENTE');
        adminData.utenti.push({
            ID_UTENTE: newId, NOME: '', USERNAME: '', PASSWORD_HASH: '',
            PROFILO: 'TECNICO', ATTIVO: true, IS_ADMIN: false, NOTE: ''
        });
        renderUtenti();
        openNewAdminCard('utenti-container');
    });
}

if (btnAddApp) {
    btnAddApp.addEventListener('click', () => {
        setAdminDirty(true);
        adminData.apps.push({
            ID_APP: adminUnique('APP',adminData.apps,'ID_APP'), NOME_APP: 'Nuova App', LINK_DEPLOYMENT: 'https://',
            DESCRIZIONE: '', ICONA: 'fa-solid fa-cube', ORDINE: 99, ATTIVA: true, VISIBILE_HOME: true, COLORE_BADGE: '#10b981', NOTE: ''
        });
        renderAppsAdmin();
        openNewAdminCard('admin-apps-container');
        renderPermessi();
    });
}

let groupPerms = {};

function renderPermessi() {
    const container=document.getElementById('permessi-container');
    container.innerHTML='';
    adminData.profili.forEach((group,index)=>{
        const members=adminData.utenti.filter(u=>u.PROFILO===group.ID_PROFILO);
        const card=document.createElement('div');card.className='admin-card';
        card.innerHTML=`<div class="admin-card-header"><span>${adminEscape(group.ID_PROFILO)} · ${members.length} utenti</span></div><div class="admin-card-body"></div>`;
        const body=card.querySelector('.admin-card-body');
        const search=document.createElement('input');search.type='search';search.placeholder='Cerca app nel gruppo…';search.setAttribute('aria-label','Cerca app nel gruppo');
        search.addEventListener('input',()=>{const query=search.value.trim().toLocaleLowerCase('it');body.querySelectorAll('.admin-permission-row').forEach(row=>row.hidden=!row.textContent.toLocaleLowerCase('it').includes(query));});
        body.appendChild(search);
        adminData.apps.filter(a=>adminYes(a.ATTIVA)).forEach(app=>{
            const values=members.map(u=>adminYes(adminData.permessi.find(p=>p.ID_UTENTE===u.ID_UTENTE&&p.ID_APP===app.ID_APP)?.ABILITATO));
            const override=groupPerms[group.ID_PROFILO]?.[app.ID_APP];
            const mixed=override===undefined&&values.some(Boolean)&&values.some(v=>!v);
            const enabled=override===undefined?values.length>0&&values.every(Boolean):override;
            const row=document.createElement('label');row.className='admin-permission-row';
            row.innerHTML=`<span>${adminEscape(app.NOME_APP)}<small>${mixed?'Misti':enabled?'Consentito':'Non consentito'}</small></span><input type="checkbox" aria-label="${adminEscape(app.NOME_APP)}" ${enabled?'checked':''}>`;
            const checkbox=row.querySelector('input');checkbox.indeterminate=mixed;
            checkbox.addEventListener('change',()=>{(groupPerms[group.ID_PROFILO]||(groupPerms[group.ID_PROFILO]={}))[app.ID_APP]=checkbox.checked;row.querySelector('small').textContent=checkbox.checked?'Consentito':'Non consentito';setAdminDirty(true);});
            body.appendChild(row);
        });
        container.appendChild(card);
    });
    compactAdminCards('permessi-container');
}

btnAdminSave.addEventListener('click', async () => {
    btnAdminSave.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    btnAdminSave.disabled = true;

    const validation = validateAdminData();
    if (validation) {alert(validation);btnAdminSave.disabled=false;btnAdminSave.textContent='Salva';return;}
    const permessiEstesi = buildAdminPermissions(adminData,groupPerms);

    try {
        const response = await authenticatedFetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({
                action: 'SAVE_ADMIN_DATA',
                revision: adminData.revision,
                adminUserId: currentUser.id || currentUser.ID_UTENTE,
                utenti_aggiornati: adminData.utenti,
                apps_aggiornate: adminData.apps,
                profili_aggiornati: adminData.profili,
                permessi_aggiornati: permessiEstesi
            })
        });
        const data = await response.json();
        if (data.status === 'success') {
            // Aggiorniamo i permessi locali con quelli appena salvati
            adminData.permessi = permessiEstesi;
            setAdminDirty(false);
            await loadAdminData();
            alert('Salvataggio completato con successo!');
        } else {
            alert('Errore al salvataggio: ' + data.message);
        }
    } catch (e) {
        alert('Errore di rete al salvataggio.');
    } finally {
        btnAdminSave.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Salva';
        btnAdminSave.disabled = false;
    }
});

// Avvia app

// ================= DRIVE VIEWER & KEYWORDS LOGIC =================

const driveViewerScreen = document.getElementById('drive-viewer-screen');
const btnCloseDriveViewer = document.getElementById('btn-close-drive-viewer');
const driveViewerTitle = document.getElementById('drive-viewer-title');
const driveViewerIcon = document.getElementById('drive-viewer-icon');
const driveViewerList = document.getElementById('drive-viewer-list');
const driveViewerLoading = document.getElementById('drive-viewer-loading');
const driveViewerError = document.getElementById('drive-viewer-error');
const driveViewerSearch = document.getElementById('drive-viewer-search');

const keywordModal = document.getElementById('keyword-modal');
const btnCloseKeywordModal = document.getElementById('btn-close-keyword-modal');
const keywordInput = document.getElementById('keyword-input');
const btnAddKeyword = document.getElementById('btn-add-keyword');
const keywordTagsContainer = document.getElementById('keyword-tags-container');
const keywordModalFileName = document.getElementById('keyword-modal-file-name');
const btnSaveKeywords = document.getElementById('btn-save-keywords');

let currentDriveFiles = [];
let currentDriveType = '';
let currentEditingFileId = null;
let currentEditingKeywords = [];

function openDriveViewerNative(type, title) {
    document.body.style.overflow = 'hidden';
    hideHomeForFullscreenView();
    driveViewerScreen.classList.remove('hidden');
    driveViewerLoading.classList.remove('hidden');
    driveViewerError.classList.add('hidden');
    driveViewerList.innerHTML = '';

    if (driveViewerSearch) {
        driveViewerSearch.value = '';
    }

    currentDriveType = type;
    if (driveViewerTitle) driveViewerTitle.textContent = title;
    if (driveViewerIcon) {
        if (type === 'procedure') {
            driveViewerIcon.className = 'fa-solid fa-book';
        } else {
            driveViewerIcon.className = 'fa-solid fa-bullhorn';
        }
    }

    fetchDriveFiles(type);
}

if (btnCloseDriveViewer) {
    btnCloseDriveViewer.addEventListener('click', () => {
        document.body.style.overflow = '';
        driveViewerScreen.classList.add('hidden');
        restoreHomeAfterFullscreenView();
    });
}

async function fetchDriveFiles(type) {
    try {
        const response = await authenticatedFetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({
                action: 'GET_DRIVE_FILES',
                type: type
            })
        });

        const data = await response.json();

        if (data.status === 'success') {
            currentDriveFiles = data.files;
            renderDriveFiles(currentDriveFiles);
        } else {
            driveViewerError.textContent = data.message || 'Errore nel caricamento dei file.';
            driveViewerError.classList.remove('hidden');
        }
    } catch (error) {
        driveViewerError.textContent = 'Errore di rete. Impossibile connettersi al server.';
        driveViewerError.classList.remove('hidden');
    } finally {
        driveViewerLoading.classList.add('hidden');
    }
}

function renderDriveFiles(files) {
    driveViewerList.innerHTML = '';

    if (files.length === 0) {
        driveViewerList.innerHTML = '<div style="text-align:center; padding: 20px; color: #94a3b8;">Nessun file trovato.</div>';
        return;
    }

    const canEditProcedure = currentUser && (currentUser.canEditProcedure === true || currentUser.isAdmin === true || currentUser.isAdmin === 'TRUE' || currentUser.isAdmin === 'Vero');

    files.forEach(file => {
        const card = document.createElement('div');
        card.style.background = 'rgba(30, 41, 59, 0.8)';
        card.style.borderRadius = '8px';
        card.style.padding = '15px';
        card.style.display = 'flex';
        card.style.flexDirection = 'column';
        card.style.gap = '10px';
        card.style.border = '1px solid rgba(255,255,255,0.05)';

        let iconClass = 'fa-solid fa-file';
        let iconColor = '#94a3b8';
        if (file.mimeType.includes('pdf')) { iconClass = 'fa-solid fa-file-pdf'; iconColor = '#ef4444'; }
        else if (file.mimeType.includes('document')) { iconClass = 'fa-solid fa-file-word'; iconColor = '#3b82f6'; }
        else if (file.mimeType.includes('spreadsheet')) { iconClass = 'fa-solid fa-file-excel'; iconColor = '#10b981'; }

        let keywordsHtml = '';
        if (file.keywords && file.keywords.length > 0) {
            keywordsHtml = '<div style="display: flex; flex-wrap: wrap; gap: 5px; margin-top: 5px;">' +
                file.keywords.map(kw => '<span style="background: rgba(16, 185, 129, 0.2); color: #10b981; font-size: 11px; padding: 2px 6px; border-radius: 4px;">' + kw + '</span>').join('') +
                '</div>';
        }

        const dateStr = new Date(file.lastUpdated).toLocaleDateString('it-IT');

        card.innerHTML = `
            <div style="display: flex; align-items: flex-start; gap: 15px;">
                <div style="font-size: 24px; color: ${iconColor};"><i class="${iconClass}"></i></div>
                <div style="flex: 1;">
                    <div style="color: white; font-weight: 600; font-size: 14px; word-break: break-word;">${file.name}</div>
                    <div style="color: #94a3b8; font-size: 11px; margin-top: 2px;">Aggiornato il: ${dateStr}</div>
                    ${keywordsHtml}
                </div>
            </div>
            <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 5px;">
                ${currentDriveType === 'procedure' && canEditProcedure ?
                '<button class="btn-secondary-small btn-edit-kw" data-id="' + file.id + '" style="background: transparent; border: 1px solid #334155; color: #cbd5e1; padding: 6px 10px;">' +
                '<i class="fa-solid fa-tags"></i> Keyword' +
                '</button>' : ''
            }
                <button onclick="openDriveFile('${file.url}', '${file.name.replace(/'/g, "\\'")}')" class="btn-primary-small" style="padding: 6px 12px;">
                    <i class="fa-solid fa-eye"></i> Apri
                </button>
            </div>
        `;

        driveViewerList.appendChild(card);
    });

    // Add event listeners to the new buttons
    document.querySelectorAll('.btn-edit-kw').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const fileId = e.currentTarget.getAttribute('data-id');
            const file = currentDriveFiles.find(f => f.id === fileId);
            if (file) {
                openKeywordModal(file);
            }
        });
    });
}

if (driveViewerSearch) {
    driveViewerSearch.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase().trim();
        if (!term) {
            renderDriveFiles(currentDriveFiles);
            return;
        }

        const filtered = currentDriveFiles.filter(file => {
            const nameMatch = file.name.toLowerCase().includes(term);
            const kwMatch = file.keywords && file.keywords.some(kw => kw.toLowerCase().includes(term));
            return nameMatch || kwMatch;
        });

        renderDriveFiles(filtered);
    });
}

// === Keyword Modal Logic ===

function openKeywordModal(file) {
    currentEditingFileId = file.id;
    currentEditingKeywords = [...(file.keywords || [])];

    if (keywordModalFileName) keywordModalFileName.textContent = file.name;
    if (keywordInput) keywordInput.value = '';
    renderKeywordTags();

    if (keywordModal) keywordModal.classList.remove('hidden');
}

if (btnCloseKeywordModal) {
    btnCloseKeywordModal.addEventListener('click', () => {
        if (keywordModal) keywordModal.classList.add('hidden');
    });
}

function renderKeywordTags() {
    if (!keywordTagsContainer) return;
    keywordTagsContainer.innerHTML = '';
    if (currentEditingKeywords.length === 0) {
        keywordTagsContainer.innerHTML = '<span style="color: #64748b; font-size: 13px;">Nessuna keyword.</span>';
        return;
    }

    currentEditingKeywords.forEach((kw, index) => {
        const tag = document.createElement('div');
        tag.style.background = '#1e293b';
        tag.style.color = '#10b981';
        tag.style.padding = '4px 8px';
        tag.style.borderRadius = '12px';
        tag.style.fontSize = '12px';
        tag.style.display = 'flex';
        tag.style.alignItems = 'center';
        tag.style.gap = '5px';
        tag.style.border = '1px solid #10b981';

        tag.innerHTML = `
            ${kw}
            <i class="fa-solid fa-xmark remove-kw" data-idx="${index}" style="cursor: pointer; color: #ef4444;"></i>
        `;
        keywordTagsContainer.appendChild(tag);
    });

    document.querySelectorAll('.remove-kw').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const idx = parseInt(e.currentTarget.getAttribute('data-idx'));
            currentEditingKeywords.splice(idx, 1);
            renderKeywordTags();
        });
    });
}

if (btnAddKeyword) {
    btnAddKeyword.addEventListener('click', () => {
        if (!keywordInput) return;
        const newKw = keywordInput.value.trim();
        if (newKw && !currentEditingKeywords.includes(newKw)) {
            currentEditingKeywords.push(newKw);
            keywordInput.value = '';
            renderKeywordTags();
        }
    });
}

if (keywordInput) {
    keywordInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (btnAddKeyword) btnAddKeyword.click();
        }
    });
}

if (btnSaveKeywords) {
    btnSaveKeywords.addEventListener('click', async () => {
        btnSaveKeywords.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
        btnSaveKeywords.disabled = true;

        try {
            const response = await authenticatedFetch(API_URL, {
                method: 'POST',
                body: JSON.stringify({
                    action: 'SAVE_PROCEDURE_KEYWORDS',
                    fileId: currentEditingFileId,
                    keywords: currentEditingKeywords
                })
            });

            const data = await response.json();

            if (data.status === 'success') {
                // Aggiorna array locale
                const file = currentDriveFiles.find(f => f.id === currentEditingFileId);
                if (file) {
                    file.keywords = [...currentEditingKeywords];
                }
                // Chiudi modale e re-render
                if (keywordModal) keywordModal.classList.add('hidden');

                // Forza re-render con ricerca corrente
                if (driveViewerSearch) {
                    const event = new Event('input');
                    driveViewerSearch.dispatchEvent(event);
                } else {
                    renderDriveFiles(currentDriveFiles);
                }
            } else {
                alert('Errore salvataggio: ' + data.message);
            }
        } catch (error) {
            alert('Errore di rete al salvataggio.');
        } finally {
            btnSaveKeywords.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Salva';
            btnSaveKeywords.disabled = false;
        }
    });
}

// Funzione globale per aprire i file Drive nativamente nell'iframe del portale
window.openDriveFile = function (url, title) {
    if (!url) return;
    // Rimosso il tentativo di apertura interna per problemi noti di X-Frame-Options con gli account Google su mobile.
    if (isIos()) {
        window.location.href = url;
    } else {
        window.open(url, '_blank');
    }
};


// ================= MODULI RAPIDI NATIVI =================

const moduliRapidiScreen = document.getElementById('moduli-rapidi-screen');

function openModuliRapidiNative() {
    hideHomeForFullscreenView();
    moduliRapidiScreen.classList.remove('hidden');
    goMenu(); // Torna sempre al menu principale all'apertura
    
    // Popola select dipendenti se non popolata
    const dipSelect = document.getElementById('dipSelect');
    if (dipSelect && dipSelect.options.length <= 1) {
        // Popola con il currentUser se disponibile
        const opt = document.createElement('option');
        opt.value = currentUser.id || currentUser.ID_UTENTE;
        opt.textContent = currentUser.nome;
        opt.selected = true;
        dipSelect.appendChild(opt);
        
        // Nascondi il loading che veniva da index.html di moduli extra
        const loadingDiv = document.getElementById('loading');
        if (loadingDiv) loadingDiv.classList.add('hidden');
        document.getElementById('menu').classList.remove('hidden');
    } else {
        const loadingDiv = document.getElementById('loading');
        if (loadingDiv) loadingDiv.classList.add('hidden');
        document.getElementById('menu').classList.remove('hidden');
    }
}

function closeModuliRapidi() {
    moduliRapidiScreen.classList.add('hidden');
    restoreHomeAfterFullscreenView();
}

function showForm(id) {
    document.getElementById('formTopbar').classList.remove('hidden');
    document.querySelectorAll('#forms-container .card').forEach(c => c.classList.add('hidden'));
    
    if (id !== 'suggerimenti') {
        const dipCard = document.getElementById('dipCard');
        if (dipCard) dipCard.classList.remove('hidden');
    }
    
    document.getElementById('form-' + id).classList.remove('hidden');
    if (id === 'mezzi') loadActiveMezzi_();
    document.getElementById('menu').classList.add('hidden');
    moduliRapidiScreen.scrollTo({ top: 0, behavior: 'smooth' });
}

async function loadActiveMezzi_() {
    const select = document.getElementById('mez_targa');
    if (!select || select.dataset.loaded === '1') return;
    select.innerHTML = '<option value="">Caricamento mezzi...</option>';
    try {
        const response = await authenticatedFetch(API_URL, {method:'POST', body:JSON.stringify({action:'GET_ACTIVE_MEZZI'})});
        const data = await response.json();
        if (data.status !== 'success') throw new Error(data.message || 'Errore caricamento');
        select.innerHTML = '<option value="">-- Seleziona il mezzo --</option>' + (data.mezzi || []).map(m => `<option value="${String(m.targa).replace(/"/g,'&quot;')}">${m.label}</option>`).join('');
        select.dataset.loaded = '1';
    } catch (e) { select.innerHTML = '<option value="">Mezzi non disponibili</option>'; }
}

function goMenu() {
    document.querySelectorAll('#forms-container .card').forEach(c => c.classList.add('hidden'));
    document.getElementById('formTopbar').classList.add('hidden');
    document.getElementById('menu').classList.remove('hidden');
    moduliRapidiScreen.scrollTo({ top: 0, behavior: 'smooth' });
}

function getDip() {
    const id = currentUser.id || currentUser.ID_UTENTE;
    const nome = currentUser.nome;
    if (!id) {
        alert("Errore: Utente non riconosciuto!");
        return null;
    }
    return { id, nome };
}

function setBtnLoading(btn, text) {
    btn.dataset.oldText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = text;
}

function resetBtn(btn) {
    btn.disabled = false;
    if (btn.dataset.oldText) btn.innerHTML = btn.dataset.oldText;
}

function getBase64(file) {
    return new Promise((res, rej) => {
        if (!file) return res('');
        const reader = new FileReader();
        reader.onload = () => res(reader.result);
        reader.onerror = error => rej(error);
        reader.readAsDataURL(file);
    });
}

async function sendModuloRequest(moduloType, payload, btn) {
    try {
        const response = await authenticatedFetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({
                action: 'SUBMIT_MODULO',
                modulo: moduloType,
                payload: payload
            })
        });
        const data = await response.json();
        if (data.status === 'success') {
            alert('Richiesta inviata con successo!');
            goMenu(); // Torna al menu
            return true;
        } else {
            alert('Errore: ' + data.message);
            return false;
        }
    } catch (error) {
        alert('Errore di rete. Riprova più tardi.');
        return false;
    } finally {
        resetBtn(btn);
    }
}

async function inviaSuggerimento(btn) {
    const testo = document.getElementById('sug_testo').value.trim();
    if (!testo) return alert("Scrivi un suggerimento!");
    setBtnLoading(btn, 'INVIO...');
    const ok = await sendModuloRequest('suggerimenti', { testo }, btn);
    if (ok) document.getElementById('sug_testo').value = '';
}

async function inviaAttrezzi(btn) {
    const dip = getDip(); if (!dip) return;
    const desc = document.getElementById('att_desc').value.trim();
    if (!desc) return alert("Descrivi l'attrezzo!");
    const file = document.getElementById('att_foto').files[0];
    setBtnLoading(btn, 'INVIO IN CORSO...');
    const b64 = await getBase64(file);
    const ok = await sendModuloRequest('attrezzi', { id: dip.id, nome: dip.nome, descrizione: desc, fotoBase64: b64 }, btn);
    if (ok) { document.getElementById('att_desc').value = ''; document.getElementById('att_foto').value = ''; }
}

async function inviaMezzi(btn) {
    const dip = getDip(); if (!dip) return;
    const targa = document.getElementById('mez_targa').value.trim();
    const desc = document.getElementById('mez_desc').value.trim();
    if (!targa || !desc) return alert("Inserisci targa e descrizione!");
    const file = document.getElementById('mez_foto').files[0];
    setBtnLoading(btn, 'INVIO IN CORSO...');
    const b64 = await getBase64(file);
    const ok = await sendModuloRequest('mezzi', { id: dip.id, nome: dip.nome, targa: targa, descrizione: desc, fotoBase64: b64 }, btn);
    if (ok) { document.getElementById('mez_targa').value = ''; document.getElementById('mez_desc').value = ''; document.getElementById('mez_foto').value = ''; }
}

async function inviaPermessi(btn) {
    const dip = getDip(); if (!dip) return;
    const tipo = document.getElementById('per_tipo').value;
    const dal = document.getElementById('per_dal').value;
    const al = document.getElementById('per_al').value;
    if (!dal || !al) return alert("Inserisci le date!");
    setBtnLoading(btn, 'INVIO...');
    const ok = await sendModuloRequest('permessi', { id: dip.id, nome: dip.nome, tipologia: tipo, dal: dal, al: al, causale: document.getElementById('per_note').value }, btn);
    if (ok) { document.getElementById('per_dal').value = ''; document.getElementById('per_al').value = ''; document.getElementById('per_note').value = ''; }
}

async function inviaPausa(btn, min) {
    const dip = getDip(); if (!dip) return;
    setBtnLoading(btn, 'INVIO...');
    await sendModuloRequest('pausa', { id: dip.id, nome: dip.nome, minuti: min }, btn);
}





window.switchAdminTab = function(tabId) {
    document.querySelectorAll('.admin-tab-btn').forEach(btn => {
        if(btn.getAttribute('onclick').includes(tabId)) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
    document.querySelectorAll('.admin-tab-content').forEach(content => {
        if(content.id === tabId) {
            content.classList.remove('hidden');
            content.classList.add('active');
        } else {
            content.classList.add('hidden');
            content.classList.remove('active');
        }
    });
};



window.navigateFolder = function(id, name) {
    driveNavStack.push({id: id, name: name});
    fetchDriveFiles(currentDriveType, id, name);
};


async function resendEmployeeInvite(index, button) {
  const user = adminData.utenti[index];
  if (!user) return;
  if (adminDirty) {alert('Salva prima le modifiche: l’invito usa le credenziali già salvate.');return;}
  button.disabled = true;
  try {
    const response = await authenticatedFetch(API_URL, {method:'POST',body:JSON.stringify({action:'RESEND_EMPLOYEE_INVITE',adminUserId:currentUser.id || currentUser.ID_UTENTE,employeeId:user.ID_UTENTE})});
    const result = await response.json();
    alert(result.message || (result.status === 'success' ? 'Invito inviato' : 'Invio fallito'));
  } catch(e) {alert('Invio fallito: ' + e.message);} finally {button.disabled=false;}
}


const accessNetworkFetch = window.fetch.bind(window);
let accessCheckInFlight = null;
let accessValidatedAt = 0, accessValidatedToken = '';
function markAccessValidated(token) {accessValidatedToken=token;accessValidatedAt=Date.now();}
const ACCESS_DENIED_CODES = ['INACTIVITY','NOT_IN_ROSTER','BADGE_REASSIGNED','ACCOUNT_DISABLED','ACCOUNT_REMOVED','SESSION_INVALID'];
function closeProtectedScreens() {
    for (const id of ['home-screen','iframe-screen','drive-viewer-screen','timbrature-screen','admin-screen','monitor-screen','moduli-rapidi-screen']) {
        const element = document.getElementById(id); if (element) element.classList.add('hidden');
    }
    homeScreen.classList.add('hidden'); adminScreen.classList.add('hidden');
    appIframe.src = 'about:blank';
    appsContainer.innerHTML = '';
    adminData = null;
    if (typeof closeCuritScanner === 'function') closeCuritScanner();
    document.body.classList.remove('fullscreen-active');
}
function showConnectionStatus(message) {
    const banner=document.getElementById('portal-connection-status');
    if(!banner)return;
    banner.querySelector('span').textContent=message;banner.classList.remove('hidden');
}
function hideConnectionStatus() {
    document.getElementById('portal-connection-status')?.classList.add('hidden');
}
document.getElementById('portal-connection-retry')?.addEventListener('click',async()=>{
    if (!currentUser)return;
    if(homeScreen.classList.contains('hidden'))await validateCurrentAccess(true);else await loadApps();
});

function revokeCurrentAccess(message) {
    localStorage.removeItem('portale_procedure_rc1_session'); currentUser = null;
    hideConnectionStatus();
    closeProtectedScreens(); showLoginScreen();
    loginError.textContent = message || 'Accesso revocato. Accedi nuovamente.';
    loginError.classList.remove('hidden');
}
async function authenticatedFetch(url, options = {}) {
    const payload = JSON.parse(options.body || '{}');
    const token = currentUser && currentUser.sessionToken;
    if (payload.action !== 'LOGIN') payload.sessionToken = token || '';
    let response;
    const mayRetry = ['LOGIN','CHECK_ACCESS','GET_USER_DATA','GET_MY_TIMBRATURE','GET_DRIVE_FILES','GET_ACTIVE_MEZZI'].includes(payload.action);
    for (let attempt=0;attempt<2;attempt++) {
        try {response=await accessNetworkFetch(url,{...options,body:JSON.stringify(payload)});break;}
        catch(error) {if (!mayRetry || attempt===1) throw error;await new Promise(resolve=>setTimeout(resolve,400));}
    }
    const result = await response.clone().json();
    if (payload.action !== 'LOGIN' && result.status === 'success' && (!currentUser || currentUser.sessionToken !== token)) throw new Error('Sessione chiusa durante la richiesta.');
    if (ACCESS_DENIED_CODES.includes(result.code) && currentUser && currentUser.sessionToken === token) revokeCurrentAccess(result.message);
    if (payload.action !== 'LOGIN' && result.status === 'success' && currentUser && currentUser.sessionToken === token) {markAccessValidated(token);hideConnectionStatus();}
    return response;
}
async function validateCurrentAccess(force = false) {
    if (!currentUser || !currentUser.sessionToken) return false;
    if (!force && accessValidatedToken === currentUser.sessionToken && Date.now()-accessValidatedAt < 60000) return true;
    if (accessCheckInFlight) return accessCheckInFlight;
    const token = currentUser.sessionToken;
    accessCheckInFlight = (async () => {
        try {
            const response = await authenticatedFetch(API_URL,{method:'POST',body:JSON.stringify({action:'CHECK_ACCESS'})});
            const result = await response.json();
            if (result.status !== 'success') {
                if (currentUser && currentUser.sessionToken === token) {
                    const message = result.message === 'Azione non valida.'
                        ? 'Il backend Apps Script non è aggiornato. Pubblica una nuova versione della distribuzione usata dalla PWA.'
                        : result.message || 'Impossibile verificare l’accesso. Riprova tra poco.';
                    if (ACCESS_DENIED_CODES.includes(result.code)) revokeCurrentAccess(message);
                    else showConnectionStatus(message);
                }
                return false;
            }
            return result.status === 'success' && !!currentUser && currentUser.sessionToken === token;
        } catch(e) {
            if (currentUser && currentUser.sessionToken === token) showConnectionStatus('Verifica temporaneamente non disponibile. Accesso conservato: controlla la connessione e riprova.');
            return false;
        }
    })();
    try {return await accessCheckInFlight;} finally {accessCheckInFlight=null;}
}
setInterval(() => {if (currentUser && !document.hidden) validateCurrentAccess(true);},60000);
document.addEventListener('visibilitychange',() => {if (!document.hidden && currentUser) validateCurrentAccess(true);});
window.addEventListener('focus',() => {if (currentUser) validateCurrentAccess(true);});
window.addEventListener('storage',event => {if (event.key === 'portale_procedure_rc1_session' && !event.newValue && currentUser) revokeCurrentAccess('Sessione chiusa. Accedi nuovamente.');});

init();
