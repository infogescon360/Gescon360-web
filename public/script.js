
/*
 * =============================================================================
 * GESCON 360 - Frontend JavaScript
 * =============================================================================
 *
 * ESTE ES EL CÓDIGO ORIGINAL DE GOOGLE APPS SCRIPT.
 *
 * PRÓXIMO PASO: Reemplazar todas las llamadas a 'google.script.run'
 * por llamadas 'fetch' a nuestras funciones de Netlify.
 * =============================================================================
 */

// 1. Ocultar Dashboard Hasta Autenticación Exitosa
function hideAllContent() {
    const sidebar = document.querySelector('.sidebar');
    const mainContent = document.querySelector('.main-content');
    if (sidebar) sidebar.style.display = 'none';
    if (mainContent) mainContent.style.display = 'none';
}
// Llamar inmediatamente al cargar
hideAllContent();

// --- CONFIGURACIÓN DE SUPABASE (CLAVES PÚBLICAS) ---
// Las claves se cargarán dinámicamente desde config.js o el backend
let SUPABASE_URL = null;
let SUPABASE_ANON_KEY = null;
// Inicializar Supabase
let supabaseClient = null;

// ============================================
// CONFIGURACIÓN DE PERMISOS POR ROL
// ============================================

const PERMISSIONS = {
    user: {
        // Módulos permitidos para usuarios normales (IDs usados en showSection)
        allowedPages: [
            'dashboard',
            'import',
            'tasks',
            'duplicates',
            'archive'
        ],
        // Capacidades
        canSearch: true,
        canViewExpediente: true,
        canEditExpediente: false,
        canDeleteExpediente: false,
        // Accesos específicos (redundante con allowedPages pero útil para lógica UI)
        canAccessReports: false,
        canAccessConfig: false
    },
    admin: {
        // Administradores tienen acceso total
        allowedPages: ['*'], 
        canSearch: true,
        canViewExpediente: true,
        canEditExpediente: true,
        canDeleteExpediente: true,
        canAccessReports: true,
        canAccessConfig: true
    }
};

// ============================================
// FUNCIONES PARA VERIFICAR PERMISOS
// ============================================

function checkPermission(permission) {
    if (!currentUser) return false;
    if (currentUser.isAdmin) return true; // Admin puede todo
    
    const permissions = PERMISSIONS['user'];
    return permissions[permission] === true;
}

function isPageAllowed(pageName) {
    if (!currentUser) return false;
    if (currentUser.isAdmin) return true;

    const allowedPages = PERMISSIONS['user'].allowedPages;
    return allowedPages.includes(pageName);
}

// Función para controlar visibilidad del menú según rol
function applyMenuAccessControl() {
    // Selectores basados en los onclick del HTML
    const restrictedSelectors = [
        'a[onclick="showSection(\'reports\')"]',
        'a[onclick="showSection(\'config\')"]'
    ];
    
    const adminSection = document.querySelector('.admin-section');

    if (!currentUser || !currentUser.isAdmin) {
        // Ocultar sección completa de administración
        if (adminSection) adminSection.style.display = 'none';
        
        // Ocultar enlaces específicos restringidos
        restrictedSelectors.forEach(selector => {
            const el = document.querySelector(selector);
            if (el && el.parentElement) el.parentElement.style.display = 'none';
        });
    } else {
        // Mostrar todo para admin
        if (adminSection) adminSection.style.display = 'block';
        restrictedSelectors.forEach(selector => {
            const el = document.querySelector(selector);
            if (el && el.parentElement) el.parentElement.style.display = '';
        });
    }
}

// Función para inyectar el botón de cambio de contraseña en el menú lateral
function addChangePasswordButtonToSidebar() {
    const sidebarMenu = document.querySelector('.sidebar-menu');
    // Evitar duplicados
    if (sidebarMenu && !document.getElementById('changePasswordLink')) {
        const li = document.createElement('li');
        li.className = 'nav-item mt-2'; 
        li.innerHTML = `
            <a href="#" class="nav-link" onclick="openChangePasswordModal(false); return false;" id="changePasswordLink" title="Cambiar mi contraseña">
                <i class="bi bi-shield-lock"></i>
                <span>Cambiar Contraseña</span>
            </a>
        `;
        
        // Insertar antes del botón de cerrar sesión (asumiendo que es el último o tiene onclick="logout()")
        const logoutLink = document.querySelector('a[onclick="logout()"]');
        if (logoutLink && logoutLink.parentElement && logoutLink.parentElement.parentNode === sidebarMenu) {
            sidebarMenu.insertBefore(li, logoutLink.parentElement);
        } else {
            sidebarMenu.appendChild(li);
        }
    }
}

// Función para cargar configuración y arrancar
async function initAppConfig() {
    try {
        // 1. Intentar cargar desde archivo de configuración local (config.js)
        if (window.GESCON_CONFIG) {
            SUPABASE_URL = window.GESCON_CONFIG.SUPABASE_URL;
            SUPABASE_ANON_KEY = window.GESCON_CONFIG.SUPABASE_ANON_KEY;
        }

        // 2. Si no hay config local, intentar obtener del backend (Variables de Entorno)
        if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
            try {
                const response = await fetch('/api/config');
                if (response.ok) {
                    const config = await response.json();
                    SUPABASE_URL = config.SUPABASE_URL;
                    SUPABASE_ANON_KEY = config.SUPABASE_ANON_KEY;
                }
            } catch (e) {
                console.warn('No se pudo obtener configuración del servidor, verificando configuración local...');
            }
        }

        // VALIDACIÓN: Asegurarse de que tenemos las claves
        if (!SUPABASE_URL || !SUPABASE_ANON_KEY || SUPABASE_URL.includes('URL_PUBLICA')) {
            throw new Error('Las claves de Supabase no están configuradas. Asegúrate de cargar config.js o configurar el backend.');
        }

        // Inicializar cliente
        supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        console.log('Supabase initialized');

        // Continuar con el flujo normal
        checkAuthStatus();
        setupEventListeners();
        setupCharCounter();
        setupStatusArchiveLogic();

    } catch (error) {
        console.error('Error de inicialización:', error);
        const errorMsg = error.message.includes('Failed to fetch')
            ? 'No se pudo conectar con el servidor. ¿Has ejecutado "npm start"? ¿Estás accediendo a localhost:3000?'
            : error.message;

        document.body.innerHTML = `
            <div class="container mt-5">
                <div class="alert alert-danger">
                    <h4><i class="bi bi-exclamation-octagon"></i> Error de Inicialización</h4>
                    <p>${errorMsg}</p>
                    <hr>
                    <p class="mb-0">Por favor, asegúrate de:</p>
                    <ol>
                        <li>Tener el archivo <code>.env</code> configurado.</li>
                        <li>Ejecutar <code>npm start</code> en la terminal.</li>
                        <li>Acceder a <a href="http://localhost:3000">http://localhost:3000</a> (no abrir el archivo directamente).</li>
                    </ol>
                </div>
            </div>`;
    }
}

// Global Variables
let currentUser = null;
let duplicatesData = [];
let usersData = [];
let activeTaskFilters = {};
let monthlyChartInstance = null;
let statusChartInstance = null;

// Variables de paginación
let currentArchivePage = 1;
const ITEMS_PER_ARCHIVE_PAGE = 50;
let currentTaskPage = 1;
const TASKS_PER_PAGE = 15;

// Variable global para la suscripción Realtime
let realtimeSubscription = null;

// 3. Timeout de 20 Minutos por Inactividad
let inactivityTimer;
const INACTIVITY_TIMEOUT = 20 * 60 * 1000; // 20 minutos en milisegundos

function resetInactivityTimer() {
    clearTimeout(inactivityTimer);
    // Solo reiniciar si el usuario está autenticado
    if (document.body.classList.contains('authenticated')) {
        inactivityTimer = setTimeout(logoutDueToInactivity, INACTIVITY_TIMEOUT);
    }
}

function initInactivityTimer() {
    // Eventos que resetean el timer
    const events = ['mousedown', 'keydown', 'scroll', 'touchstart', 'click'];
    
    events.forEach(event => {
        document.addEventListener(event, resetInactivityTimer, true);
    });
    
    // Iniciar el timer
    resetInactivityTimer();
}

async function logoutDueToInactivity() {
    console.log('Sesión cerrada por inactividad');
    try {
        await logout();
    } catch (e) {
        console.error('Error al cerrar sesión por inactividad:', e);
    }
    alert('Sesión cerrada por inactividad');
}

// System Limits
let systemLimits = {
    maxFileSize: 10, // MB
    maxConcurrentFiles: 5,
    maxExpedientes: 5000,
    maxActiveTasks: 2000,
    maxArchivedExpedientes: 10000
};

// --- SISTEMA GLOBAL DE MANEJO DE ERRORES ---
// Captura cualquier promesa rechazada que no tenga un bloque .catch() asociado
window.addEventListener('unhandledrejection', function(event) {
    console.error('Promesa rechazada no controlada:', event.reason);
    
    let message = 'Error desconocido';
    if (event.reason) {
        // Extraer mensaje si es un objeto Error o convertir a string
        message = event.reason.message || String(event.reason);
        if (message === '[object Object]') {
            try { message = JSON.stringify(event.reason); } catch(e) {}
        }
    }

    showToast('danger', 'Error Inesperado', `Se ha producido un error: ${message}`);
    hideLoading(); // Asegurar que la interfaz no se quede bloqueada con un spinner
});

// Captura errores de sintaxis y tiempo de ejecución (no promesas)
window.onerror = function(message, source, lineno, colno, error) {
    console.error('Error global detectado:', { message, source, lineno, colno, error });
    
    // Evitar bucles infinitos si showToast falla
    try {
        const errorMsg = message || 'Error desconocido';
        const fileName = source ? source.split('/').pop() : '';
        const location = fileName ? ` en ${fileName}:${lineno}` : '';
        showToast('danger', 'Error de Aplicación', `${errorMsg}${location}`);
    } catch (e) {
        console.error('Error al mostrar notificación de error:', e);
    }
    
    hideLoading(); // Asegurar que la interfaz no se quede bloqueada
    return false; // Permitir que el error se propague a la consola
};

// Show/hide loading overlay
function showLoading() {
    document.getElementById('loadingOverlay').classList.add('show');
}

function hideLoading() {
    document.getElementById('loadingOverlay').classList.remove('show');
}

// Show toast notification
function showToast(type, title, message) {
    // Create toast container if it doesn't exist
    let toastContainer = document.getElementById('toastContainer');
    if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.id = 'toastContainer';
        toastContainer.className = 'toast-container position-fixed bottom-0 end-0 p-3';
        document.body.appendChild(toastContainer);
    }

    // Create toast element
    const toastId = 'toast-' + Date.now();
    const toastHtml = `
        <div id="${toastId}" class="toast" role="alert" aria-live="assertive" aria-atomic="true">
            <div class="toast-header bg-${type} text-white">
                <strong class="me-auto">${title}</strong>
                <small>Ahora</small>
                <button type="button" class="btn-close btn-close-white" data-bs-dismiss="toast" aria-label="Close"></button>
            </div>
            <div class="toast-body">
                ${message}
            </div>
        </div>
    `;

    toastContainer.insertAdjacentHTML('beforeend', toastHtml);

    // Show toast
    const toastElement = document.getElementById(toastId);
    const toast = new bootstrap.Toast(toastElement);
    toast.show();

    // Remove toast after hidden
    toastElement.addEventListener('hidden.bs.toast', function () {
        toastElement.remove();
    });
}

// --- MODAL DE SEGURIDAD REUTILIZABLE ---
function getOrCreateSecurityModal() {
    let modalEl = document.getElementById('securityModal');
    if (!modalEl) {
        const modalHtml = `
        <div class="modal fade" id="securityModal" tabindex="-1" aria-hidden="true" data-bs-backdrop="static">
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content border-danger">
                    <div class="modal-header bg-danger text-white">
                        <h5 class="modal-title" id="securityModalTitle"><i class="bi bi-exclamation-triangle-fill"></i> Confirmación de Seguridad</h5>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <div class="modal-body">
                        <p id="securityModalMessage" class="mb-3"></p>
                        <div class="mb-3">
                            <label class="form-label">Para confirmar, escribe "<strong id="securityExpectedText"></strong>" abajo:</label>
                            <input type="text" class="form-control" id="securityInput" autocomplete="off">
                            <div class="invalid-feedback">El texto no coincide.</div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
                        <button type="button" class="btn btn-danger" id="securityConfirmBtn">Confirmar Acción</button>
                    </div>
                </div>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        modalEl = document.getElementById('securityModal');
    }
    return modalEl;
}

function requestSecurityConfirmation(title, message, expectedText) {
    return new Promise((resolve) => {
        const modalEl = getOrCreateSecurityModal();
        let modal = bootstrap.Modal.getInstance(modalEl);
        if (!modal) modal = new bootstrap.Modal(modalEl);
        
        document.getElementById('securityModalTitle').innerHTML = `<i class="bi bi-exclamation-triangle-fill"></i> ${title}`;
        document.getElementById('securityModalMessage').innerHTML = message.replace(/\n/g, '<br>');
        document.getElementById('securityExpectedText').textContent = expectedText;
        
        const input = document.getElementById('securityInput');
        input.value = '';
        input.classList.remove('is-invalid');
        
        const confirmBtn = document.getElementById('securityConfirmBtn');
        const newConfirmBtn = confirmBtn.cloneNode(true);
        confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
        
        let resolved = false;

        const handleConfirm = () => {
            if (input.value === expectedText) {
                resolved = true;
                modal.hide();
                resolve(true);
            } else {
                input.classList.add('is-invalid');
            }
        };

        newConfirmBtn.addEventListener('click', handleConfirm);
        input.onkeydown = (e) => {
            input.classList.remove('is-invalid');
            if (e.key === 'Enter') {
                e.preventDefault();
                handleConfirm();
            }
        };

        const handleHidden = () => {
            modalEl.removeEventListener('hidden.bs.modal', handleHidden);
            if (!resolved) resolve(false);
        };
        
        modalEl.addEventListener('hidden.bs.modal', handleHidden);
        modal.show();
        setTimeout(() => input.focus(), 500);
    });
}

// --- MODAL DE CONFIRMACIÓN SIMPLE (SÍ/NO) ---
function getOrCreateConfirmModal() {
    let modalEl = document.getElementById('confirmModal');
    if (!modalEl) {
        const modalHtml = `
        <div class="modal fade" id="confirmModal" tabindex="-1" aria-hidden="true" data-bs-backdrop="static">
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title" id="confirmModalTitle">Confirmación</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <div class="modal-body">
                        <p id="confirmModalMessage"></p>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
                        <button type="button" class="btn btn-primary" id="confirmModalBtn">Confirmar</button>
                    </div>
                </div>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        modalEl = document.getElementById('confirmModal');
    }
    return modalEl;
}

function showConfirmModal(title, message, confirmText = 'Confirmar', confirmClass = 'btn-primary') {
    return new Promise((resolve) => {
        const modalEl = getOrCreateConfirmModal();
        let modal = bootstrap.Modal.getInstance(modalEl);
        if (!modal) modal = new bootstrap.Modal(modalEl);

        document.getElementById('confirmModalTitle').textContent = title;
        document.getElementById('confirmModalMessage').innerHTML = message.replace(/\n/g, '<br>');
        
        const confirmBtn = document.getElementById('confirmModalBtn');
        confirmBtn.textContent = confirmText;
        confirmBtn.className = `btn ${confirmClass}`;
        
        // Clonar botón para eliminar listeners anteriores
        const newConfirmBtn = confirmBtn.cloneNode(true);
        confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
        
        let resolved = false;

        const handleConfirm = () => {
            resolved = true;
            modal.hide();
            resolve(true);
        };

        newConfirmBtn.addEventListener('click', handleConfirm);

        const handleHidden = () => {
            modalEl.removeEventListener('hidden.bs.modal', handleHidden);
            if (!resolved) resolve(false);
        };

        modalEl.addEventListener('hidden.bs.modal', handleHidden);
        modal.show();
    });
}

// Initialize Application
document.addEventListener('DOMContentLoaded', function () {
    // Visual debugger desactivado
    console.log('Application initialized');

    // Iniciar carga de configuración
    initAppConfig();
});

// Configurar el contador de caracteres
function setupCharCounter() {
    const textarea = document.getElementById('taskDescription');
    const charCount = document.getElementById('char-count');

    if (textarea && charCount) {
        textarea.addEventListener('input', () => {
            charCount.textContent = textarea.value.length;
        });
    }
}

// Configurar la lógica de estados y archivado
function setupStatusArchiveLogic() {
    const statusSelect = document.getElementById('taskStatus');
    const archiveOption = document.getElementById('archive-option');

    if (statusSelect && archiveOption) {
        statusSelect.addEventListener('change', () => {
            const finalStates = ['Datos NO válidos', 'Rehusado NO cobertura', 'Recobrado'];

            if (finalStates.includes(statusSelect.value)) {
                archiveOption.classList.remove('d-none'); // Muestra la opción
            } else {
                archiveOption.classList.add('d-none');  // Oculta la opción
                document.getElementById('archive-checkbox').checked = false; // Resetea el checkbox
            }
        });
    }
}

// Check authentication status
async function checkAuthStatus() {
    console.log('Checking authentication status...');
    showLoading();

    try {
        const { data: { session }, error } = await supabaseClient.auth.getSession();

        if (error) throw error;

        hideLoading();

        if (session && session.user) {
            // Obtener perfil completo (nombre y rol) desde Supabase
            let fullName = session.user.email.split('@')[0];
            let isAdmin = false;

            try {
                // Usar endpoint del backend para evitar error de recursión RLS
                const response = await fetch('/api/profile/me', {
                    headers: {
                        'Authorization': `Bearer ${session.access_token}`
                    }
                });

                if (response.ok) {
                    const profile = await response.json();
                    if (profile) {
                        if (profile.full_name) fullName = profile.full_name;
                        if (profile.role === 'admin') isAdmin = true;
                    }
                }
            } catch (e) {
                console.warn('Error obteniendo perfil:', e);
            }

            currentUser = {
                email: session.user.email,
                name: fullName,
                id: session.user.id,
                isAdmin: isAdmin
            };
            
            // 2. Mostrar Dashboard Solo Tras Validación
            document.body.classList.add('authenticated');

            // Ejecutar automatizaciones diarias (Emails, Archivado)
            runDailyAutomations();
            
            // Aplicar control de acceso al menú lateral
            applyMenuAccessControl();
            addChangePasswordButtonToSidebar();
            
            // Mostrar elementos del dashboard explícitamente
            const sidebar = document.querySelector('.sidebar');
            const mainContent = document.querySelector('.main-content');
            if (sidebar) sidebar.style.display = 'block';
            if (mainContent) mainContent.style.display = 'block';
            
            initInactivityTimer();
            showApp();
            await initializeApp();
                        
            // Load dashboard statistics and user display
            await loadDashboardStats();
            updateUserDisplay();
        } else {
            showAuth();
        }
    } catch (error) {
        console.error('Error checking auth status:', error);
        hideLoading();
        showAuth();
    }
}

// Setup event listeners
function setupEventListeners() {
    console.log('Setting up event listeners...');

    // Login form
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', function (e) {
            e.preventDefault();
            console.log('Login form submitted');
            login();
        });
    }

    // File upload container click handler
    const fileUploadContainer = document.getElementById('fileUploadContainer');
    const importFileInput = document.getElementById('importFile');
    
    if (fileUploadContainer && importFileInput) {
        fileUploadContainer.addEventListener('click', function() {
            importFileInput.click();
        });
        
        // Handle file selection
        importFileInput.addEventListener('change', function(e) {
            const file = e.target.files[0];
            if (file) {
                console.log('File selected:', file.name);
                showToast('success', 'Archivo seleccionado', `Archivo: ${file.name}`);
                // Automatically process the file
                importarExpedientes();
            }
        });

                // Drag and drop handlers
        if (fileUploadContainer) {
            fileUploadContainer.addEventListener('dragover', function(e) {
                e.preventDefault();
                e.stopPropagation();
                fileUploadContainer.classList.add('drag-over');
            });
            
            fileUploadContainer.addEventListener('dragleave', function(e) {
                e.preventDefault();
                e.stopPropagation();
                fileUploadContainer.classList.remove('drag-over');
            });
            
            fileUploadContainer.addEventListener('drop', function(e) {
                e.preventDefault();
                e.stopPropagation();
                fileUploadContainer.classList.remove('drag-over');
                
                const files = e.dataTransfer.files;
                if (files.length > 0) {
                    importFileInput.files = files;
                    const event = new Event('change', { bubbles: true });
                    importFileInput.dispatchEvent(event);
                }
            });
        }
    }

    // Toggle password visibility
    const togglePassword = document.getElementById('togglePassword');
    if (togglePassword) {
        togglePassword.addEventListener('click', function () {
            togglePasswordVisibility('loginPassword', 'togglePassword');
        });
    }
}

// Toggle password visibility
function togglePasswordVisibility(inputId, buttonId) {
    const input = document.getElementById(inputId);
    const button = document.getElementById(buttonId);
    const icon = button.querySelector('i');

    if (input.type === 'password') {
        input.type = 'text';
        icon.classList.remove('bi-eye');
        icon.classList.add('bi-eye-slash');
    } else {
        input.type = 'password';
        icon.classList.remove('bi-eye-slash');
        icon.classList.add('bi-eye');
    }
}

// Hide create admin button after first user is created
function hideCreateAdminButton() {
    const createAdminBtn = document.getElementById('createAdminButton');
    if (createAdminBtn) {
        createAdminBtn.style.display = 'none';
    }
}

// Show/hide main containers
function showAuth() {
    console.log('Showing auth container');
    const authContainer = document.getElementById('authContainer');
    const appContainer = document.getElementById('appContainer');
    
    // Forzar ocultación del app y mostrar auth
    if (authContainer) {
        authContainer.classList.remove('d-none');
        authContainer.style.display = ''; // Dejar que CSS controle el display (flex)
        authContainer.style.opacity = '1';
    }
    
    if (appContainer) {
        appContainer.classList.add('d-none');
        appContainer.style.display = 'none';
        appContainer.style.visibility = 'hidden';
        appContainer.style.opacity = '0';
    }
    
    // Limpiar formulario
    const loginEmail = document.getElementById('loginEmail');
    const loginPassword = document.getElementById('loginPassword');
    if (loginEmail) loginEmail.value = '';
    if (loginPassword) loginPassword.value = '';
}

// Show app container
function showApp() {
    const appContainer = document.getElementById('appContainer');
    if (appContainer) {
        appContainer.classList.remove('d-none');
        appContainer.style.display = 'block';
        appContainer.style.opacity = '1';
        appContainer.style.visibility = 'visible';
    }
    const authContainer = document.getElementById('authContainer');
    if (authContainer) {
        authContainer.style.display = 'none';
        authContainer.classList.add('d-none');
    }
}

// Login function
async function login() {
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;

        // Validar dominio
    if (!email.endsWith('@gescon360.es')) {
        showToast('danger', 'Error de validación', 'El dominio del correo debe ser @gescon360.es');
        return;
    }


    console.log('Login attempt with email:', email);

    // Show loading
    const loginButtonText = document.getElementById('loginButtonText');
    const loginSpinner = document.getElementById('loginSpinner');
    const loginButton = document.getElementById('loginButton');

    loginButtonText.classList.add('d-none');
    loginSpinner.classList.remove('d-none');
    loginButton.disabled = true;

    try {
        // Usar endpoint del backend para login (Rate Limiting + Validación)
        const response = await fetch('https://gescon360-web.onrender.com/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Error en login');
        }

        // Hide loading
        loginButtonText.classList.remove('d-none');
        loginSpinner.classList.add('d-none');
        loginButton.disabled = false;

        // Guardar token y datos de usuario
        localStorage.setItem('accessToken', data.accessToken);
        localStorage.setItem('user', JSON.stringify(data.user));
        
        // Establecer sesión en Supabase Client para compatibilidad
        if (data.accessToken) {
            await supabaseClient.auth.setSession({
                access_token: data.accessToken,
                refresh_token: data.accessToken // Fallback
            });
        }

        // Obtener perfil completo (nombre y rol)
        let fullName = data.user.email.split('@')[0];
        let isAdmin = data.user.role === 'admin' || data.user.isSuperAdmin;

        try {
            const profileResponse = await fetch('/api/profile/me', {
                headers: {
                    'Authorization': `Bearer ${data.accessToken}`
                }
            });

            if (profileResponse.ok) {
                const profile = await profileResponse.json();
                if (profile) {
                    if (profile.full_name) fullName = profile.full_name;
                    // Confirmar rol desde perfil si es necesario
                }
            }
        } catch (e) {
            console.warn('Error obteniendo perfil:', e);
        }

        currentUser = {
            email: data.user.email,
            name: fullName,
            id: data.user.id,
            isAdmin: isAdmin
        };
        
        document.body.classList.add('authenticated');
        
        // Mostrar dashboard explícitamente
        const sidebar = document.querySelector('.sidebar');
        const mainContent = document.querySelector('.main-content');
        if (sidebar) sidebar.style.display = 'block';
        if (mainContent) mainContent.style.display = 'block';
        
        initInactivityTimer();
        showApp();
        initializeApp();
        hideCreateAdminButton(); // Hide admin button after login
        showToast('success', 'Bienvenido', 'Has iniciado sesión correctamente');

        // Verificar si se requiere cambio de contraseña obligatorio
        if (data.mustChangePassword) {
            // Pequeño delay para asegurar que la UI cargó
            setTimeout(() => openChangePasswordModal(true), 500);
        }

    } catch (error) {
        console.error('Login error:', error);
        showToast('danger', 'Error de inicio de sesión', error.message);
        
        // Restaurar estado del botón
        document.getElementById('loginButtonText').classList.remove('d-none');
        document.getElementById('loginSpinner').classList.add('d-none');
        document.getElementById('loginButton').disabled = false;
    }
}

// --- GESTIÓN DE CAMBIO DE CONTRASEÑA ---

function getOrCreateChangePasswordModal() {
    let modalEl = document.getElementById('changePasswordModal');
    if (!modalEl) {
        const modalHtml = `
        <div class="modal fade" id="changePasswordModal" tabindex="-1" aria-hidden="true" data-bs-backdrop="static" data-bs-keyboard="false">
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content">
                    <div class="modal-header bg-warning text-dark">
                        <h5 class="modal-title" id="changePasswordTitle"><i class="bi bi-shield-lock"></i> Cambiar Contraseña</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close" id="btnCloseChangePass"></button>
                    </div>
                    <div class="modal-body">
                        <div id="passwordChangeAlert" class="alert alert-warning d-none">
                            <i class="bi bi-exclamation-triangle"></i> Tu contraseña ha caducado o es el primer inicio. Debes cambiarla.
                        </div>
                        <form id="changePasswordForm">
                            <div class="mb-3">
                                <label class="form-label">Contraseña Actual</label>
                                <input type="password" class="form-control" id="cpCurrent" required>
                            </div>
                            <div class="mb-3">
                                <label class="form-label">Nueva Contraseña</label>
                                <input type="password" class="form-control" id="cpNew" required>
                                <div class="form-text small">
                                    Mínimo 12 caracteres, letras, números y un carácter especial.
                                </div>
                            </div>
                            <div class="mb-3">
                                <label class="form-label">Confirmar Nueva Contraseña</label>
                                <input type="password" class="form-control" id="cpConfirm" required>
                            </div>
                        </form>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal" id="btnCancelChangePass">Cancelar</button>
                        <button type="button" class="btn btn-primary" onclick="submitPasswordChange()">Actualizar Contraseña</button>
                    </div>
                </div>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        modalEl = document.getElementById('changePasswordModal');
    }
    return modalEl;
}

function openChangePasswordModal(forced = false) {
    const modalEl = getOrCreateChangePasswordModal();
    const form = document.getElementById('changePasswordForm');
    form.reset();

    const alertBox = document.getElementById('passwordChangeAlert');
    const btnClose = document.getElementById('btnCloseChangePass');
    const btnCancel = document.getElementById('btnCancelChangePass');

    if (forced) {
        alertBox.classList.remove('d-none');
        // Deshabilitar cierre si es obligatorio
        btnClose.style.display = 'none';
        btnCancel.style.display = 'none';
    } else {
        alertBox.classList.add('d-none');
        btnClose.style.display = 'block';
        btnCancel.style.display = 'block';
    }

    const modal = new bootstrap.Modal(modalEl);
    modal.show();
}

async function submitPasswordChange() {
    const current = document.getElementById('cpCurrent').value;
    const newPass = document.getElementById('cpNew').value;
    const confirm = document.getElementById('cpConfirm').value;

    if (newPass !== confirm) {
        showToast('warning', 'Error', 'Las nuevas contraseñas no coinciden.');
        return;
    }

    showLoading();
    try {
        const session = await supabaseClient.auth.getSession();
        const token = session?.data?.session?.access_token;
        
        const response = await fetch('/api/change-password', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ currentPassword: current, newPassword: newPass })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Error al cambiar la contraseña');
        }

        showToast('success', 'Éxito', 'Contraseña actualizada correctamente. Por favor inicia sesión de nuevo.');
        
        // Cerrar modal y sesión para forzar re-login con nueva pass
        const modalEl = document.getElementById('changePasswordModal');
        const modal = bootstrap.Modal.getInstance(modalEl);
        modal.hide();
        
        setTimeout(() => logout(), 2000);

    } catch (error) {
        console.error('Error changing password:', error);
        showToast('danger', 'Error', error.message);
    } finally {
        hideLoading();
    }
}

// Logout function
async function logout() {
    console.log('Logout attempt');

    try {
        const { error } = await supabaseClient.auth.signOut();

        if (error) throw error;

        // Desuscribirse de Realtime
        if (realtimeSubscription) {
            supabaseClient.removeChannel(realtimeSubscription);
            realtimeSubscription = null;
        }

        // Limpiar localStorage
        localStorage.removeItem('accessToken');
        localStorage.removeItem('user');

        // Limpiar estado de autenticación y timers
        document.body.classList.remove('authenticated');
        clearTimeout(inactivityTimer);
        const events = ['mousedown', 'keydown', 'scroll', 'touchstart', 'click'];
        events.forEach(event => {
            document.removeEventListener(event, resetInactivityTimer, true);
        });

        currentUser = null;
        showAuth();
        showToast('info', 'Sesión cerrada', 'Has cerrado sesión correctamente');
    } catch (error) {
        console.error('Logout error:', error);
        // Even if there's an error, clear the local session
        if (realtimeSubscription) {
            supabaseClient.removeChannel(realtimeSubscription);
            realtimeSubscription = null;
        }

        // Limpiar localStorage también en caso de error
        localStorage.removeItem('accessToken');
        localStorage.removeItem('user');

        document.body.classList.remove('authenticated');
        clearTimeout(inactivityTimer);
        const events = ['mousedown', 'keydown', 'scroll', 'touchstart', 'click'];
        events.forEach(event => {
            document.removeEventListener(event, resetInactivityTimer, true);
        });
        currentUser = null;
        showAuth();
        showToast('info', 'Sesión cerrada', 'Has cerrado sesión correctamente');
    }
}

// ============================================================================
// FUNCIONES DE NAVEGACIÓN E INTERACCIÓN DE LA UI (AÑADIDAS PARA CORREGIR ERRORES)
// ============================================================================

// Muestra una sección específica y oculta las demás
function showSection(sectionId) {
    // Verificar permisos antes de mostrar la sección
    if (typeof isPageAllowed === 'function' && !isPageAllowed(sectionId)) {
        showToast('danger', 'Acceso Denegado', 'No tienes permisos para acceder a esta sección.');
        return;
    }

    // Oculta todas las secciones
    document.querySelectorAll('.content-section').forEach(section => {
        section.classList.remove('active');
    });

    // Quita la clase active de todos los enlaces del menú
    document.querySelectorAll('.sidebar-menu a').forEach(link => {
        link.classList.remove('active');
    });

    // Muestra la sección seleccionada
    const targetSection = document.getElementById(sectionId);
    if (targetSection) {
        targetSection.classList.add('active');
    }

    // Resalta el enlace del menú activo
    const activeLink = document.querySelector(`.sidebar-menu a[onclick="showSection('${sectionId}')"]`);
    if (activeLink) {
        activeLink.classList.add('active');
    }

    // Actualiza el título de la página
    const pageTitle = document.getElementById('pageTitle');
    if (pageTitle) {
        const titles = {
            'dashboard': 'Dashboard',
            'import': 'Importar Expedientes',
            'tasks': 'Gestión de Tareas',
            'duplicates': 'Duplicados',
            'reports': 'Reportes',
            'archive': 'Archivados',
            'config': 'Configuración',
            'admin': 'Gestión de Responsables',
            'workload': 'Distribución de Carga',
            'limits': 'Límites del Sistema',
            'users': 'Gestión de Usuarios'
        };
        pageTitle.textContent = titles[sectionId] || 'GESCON 360';

        // Cargar datos específicos de la sección
        if (sectionId === 'tasks') loadTasks();
        if (sectionId === 'duplicates') loadDuplicates();
        if (sectionId === 'users') loadUsers();
        if (sectionId === 'archive') loadArchivedExpedients();
        if (sectionId === 'workload') loadWorkloadStats();
        if (sectionId === 'admin') loadResponsibles();
        if (sectionId === 'limits') loadSystemLimits();
        if (sectionId === 'config') loadGeneralConfig();
        // if (sectionId === 'reports') loadReports(); // Desactivado para evitar carga automática lenta
        if (sectionId === 'import') loadImportLogs();
    }
}

// Alterna la visibilidad de la barra lateral en móviles
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    if (sidebar) {
        sidebar.classList.toggle('active');
    }
}

// Cierra un modal
function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('active');
    }
}

// Muestra el modal de notificaciones
function showNotifications() {
    const modal = document.getElementById('notificationModal');
    if (modal) {
        modal.classList.add('active');
    }
}

// ============================================================================
// FUNCIONES PLACEHOLDER (PARA EVITAR ERRORES DE ONCLICK)
// ============================================================================

async function searchExpedients() {
    console.log('Función searchExpedients llamada');
    
    const expedientNum = document.getElementById('searchExpedient').value.trim();
    const policyNum = document.getElementById('searchPolicy').value.trim();
    const sgrNum = document.getElementById('searchSGR').value.trim();
    const dni = document.getElementById('searchDNI').value.trim();

    if (!expedientNum && !policyNum && !sgrNum && !dni) {
        showToast('warning', 'Búsqueda vacía', 'Por favor ingrese al menos un criterio de búsqueda.');
        return;
    }

    showLoading();
    const resultsContainer = document.getElementById('searchResults');
    if (resultsContainer) resultsContainer.style.display = 'none';

    try {
        let query = supabaseClient.from('expedientes').select('*');

        if (expedientNum) query = query.ilike('num_siniestro', `%${expedientNum}%`);
        if (policyNum) query = query.ilike('num_poliza', `%${policyNum}%`);
        if (sgrNum) query = query.ilike('num_sgr', `%${sgrNum}%`);
        if (dni) query = query.ilike('dni', `%${dni}%`);

        const { data, error } = await query;

        if (error) throw error;

        renderSearchResults(data);
        
    } catch (error) {
        console.error('Error en búsqueda:', error);
        showToast('danger', 'Error de búsqueda', error.message);
    } finally {
        hideLoading();
    }
}

function renderSearchResults(results) {
    const resultsContainer = document.getElementById('searchResults');
    const tableBody = document.getElementById('searchResultsTable');
    const countLabel = document.getElementById('resultCount');

    if (!resultsContainer || !tableBody) return;

    tableBody.innerHTML = '';
    
    if (!results || results.length === 0) {
        if (countLabel) countLabel.textContent = '0 resultados encontrados';
        tableBody.innerHTML = '<tr><td colspan="9" class="text-center p-4">No se encontraron expedientes con los criterios proporcionados.</td></tr>';
        resultsContainer.style.display = 'block';
        return;
    }

    if (countLabel) countLabel.textContent = `${results.length} resultados encontrados`;

    results.forEach(exp => {
        const row = document.createElement('tr');
        
        const fechaVencimiento = exp.fecha_seguimiento ? formatDate(exp.fecha_seguimiento) : (exp.fecha_ocurrencia ? formatDate(exp.fecha_ocurrencia) : '-');
        const importe = exp.importe ? new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(exp.importe) : '€0,00';
        const estadoClass = getStatusClass(exp.estado);

        row.innerHTML = `
            <td>${exp.num_siniestro || '-'}</td>
            <td>${exp.num_poliza || '-'}</td>
            <td>${exp.num_sgr || '-'}</td>
            <td>${exp.nombre_asegurado || '-'}</td>
            <td>${exp.dni || '-'}</td>
            <td><span class="status-badge status-${estadoClass}">${exp.estado || 'Desconocido'}</span></td>
            <td>${fechaVencimiento}</td>
            <td>${importe}</td>
            <td>
                <button class="btn btn-sm btn-outline-primary" onclick="viewExpedient('${exp.id}')" title="Ver detalle">
                    <i class="bi bi-eye"></i>
                </button>
                <button class="btn btn-sm btn-outline-secondary" onclick="editExpedient('${exp.id}')" title="Editar">
                    <i class="bi bi-pencil"></i>
                </button>
            </td>
        `;
        tableBody.appendChild(row);
    });

    resultsContainer.style.display = 'block';
}

function getStatusClass(status) {
    if (!status) return 'pendiente';
    const s = status.toLowerCase();
    if (s.includes('completado') || s.includes('finalizado')) return 'completado';
    if (s.includes('proceso') || s.includes('gestión')) return 'proceso';
    if (s.includes('archivado')) return 'archivado';
    if (s.includes('revisión')) return 'pdte-revision';
    return 'pendiente';
}

function formatDate(dateString) {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return isNaN(date.getTime()) ? dateString : date.toLocaleDateString('es-ES');
}

async function viewExpedient(id) {
    console.log('Ver expediente:', id);
    showLoading();

    try {
        const { data: exp, error } = await supabaseClient
            .from('expedientes')
            .select('*')
            .eq('id', id)
            .single();

        if (error) throw error;

        // Helper para asignar texto
        const setText = (elemId, val) => {
            const el = document.getElementById(elemId);
            if (el) el.textContent = val || '-';
        };

        // Rellenar campos del modal
        setText('viewNumExpediente', exp.num_siniestro);
        setText('viewNumPoliza', exp.num_poliza);
        setText('viewNumSGR', exp.num_sgr);
        
        const estadoSpan = document.getElementById('viewEstado');
        if (estadoSpan) {
            estadoSpan.textContent = exp.estado || 'Desconocido';
            estadoSpan.className = `status-badge status-${getStatusClass(exp.estado)}`;
        }

        const importeFormatted = exp.importe 
            ? new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(exp.importe) 
            : '€0,00';
        setText('viewImporte', importeFormatted);
        
        setText('viewFecha', formatDate(exp.fecha_ocurrencia));
        setText('viewAsegurado', exp.nombre_asegurado);
        setText('viewDNI', exp.dni);
        setText('viewDireccion', exp.direccion_asegurado);
        setText('viewCP', exp.cp);
        
        setText('viewTipoDano', exp.tipo_dano);
        setText('viewCausante', exp.nombre_causante);
        setText('viewCiaCausante', exp.cia_causante);

        // Configurar botón de editar
        const btnEdit = document.getElementById('btnEditExpedient');
        if (btnEdit) {
            btnEdit.onclick = () => {
                closeModal('expedientModal');
                editExpedient(id);
            };
        }

        // Mostrar Modal
        const modal = document.getElementById('expedientModal');
        if (modal) {
            modal.classList.add('active');
        }

    } catch (error) {
        console.error('Error fetching expediente:', error);
        showToast('danger', 'Error', 'No se pudo cargar el expediente: ' + error.message);
    } finally {
        hideLoading();
    }
}

async function editExpedient(id) {
    console.log('Editar expediente:', id);
    
    if (!checkPermission('canEditExpediente')) {
        showToast('danger', 'Acceso Denegado', 'No tienes permisos para editar expedientes.');
        return;
    }

    showLoading();

    try {
        const { data: exp, error } = await supabaseClient
            .from('expedientes')
            .select('*')
            .eq('id', id)
            .single();

        if (error) throw error;

        // Populate form
        document.getElementById('editExpedientId').value = exp.id;
        document.getElementById('editNumSiniestro').value = exp.num_siniestro || '';
        document.getElementById('editNumPoliza').value = exp.num_poliza || '';
        document.getElementById('editNumSGR').value = exp.num_sgr || '';
        document.getElementById('editEstado').value = exp.estado || 'Pendiente';
        document.getElementById('editImporte').value = exp.importe || 0;
        document.getElementById('editAsegurado').value = exp.nombre_asegurado || '';
        document.getElementById('editDNI').value = exp.dni || '';

        // Show modal
        const modal = document.getElementById('editExpedientModal');
        if (modal) modal.classList.add('active');

    } catch (error) {
        console.error('Error fetching expediente for edit:', error);
        showToast('danger', 'Error', 'No se pudo cargar el expediente para editar: ' + error.message);
    } finally {
        hideLoading();
    }
}

async function saveExpedientChanges() {
    const id = document.getElementById('editExpedientId').value;
    if (!id) return;

    const updates = {
        num_siniestro: document.getElementById('editNumSiniestro').value,
        num_poliza: document.getElementById('editNumPoliza').value,
        num_sgr: document.getElementById('editNumSGR').value,
        estado: document.getElementById('editEstado').value,
        importe: parseFloat(document.getElementById('editImporte').value) || 0,
        nombre_asegurado: document.getElementById('editAsegurado').value,
        dni: document.getElementById('editDNI').value
    };

    showLoading();
    try {
        const { error } = await supabaseClient
            .from('expedientes')
            .update(updates)
            .eq('id', id);

        if (error) throw error;

        showToast('success', 'Éxito', 'Expediente actualizado correctamente');
        closeModal('editExpedientModal');
        
        // Refresh search results if visible
        const searchResults = document.getElementById('searchResults');
        if (searchResults && searchResults.style.display !== 'none') {
            searchExpedients();
        }
        loadDashboardStats();

    } catch (error) {
        console.error('Error updating expediente:', error);
        showToast('danger', 'Error', 'No se pudo actualizar el expediente: ' + error.message);
    } finally {
        hideLoading();
    }
}

function clearSearch() {
    console.log('Función clearSearch llamada');
    document.getElementById('searchExpedient').value = '';
    document.getElementById('searchPolicy').value = '';
    document.getElementById('searchSGR').value = '';
    document.getElementById('searchDNI').value = '';
    document.getElementById('searchResults').style.display = 'none';
    showToast('info', 'Limpio', 'Los campos de búsqueda han sido limpiados.');
}

function advancedSearch() {
    console.log('Función advancedSearch llamada');
    const modal = document.getElementById('advancedSearchModal');
    if (modal) {
        modal.classList.add('active');
    }
}

async function performAdvancedSearch() {
    console.log('Ejecutando búsqueda avanzada...');
    closeModal('advancedSearchModal');
    showLoading();
    
    // Get values
    const dateStart = document.getElementById('advDateStart').value;
    const dateEnd = document.getElementById('advDateEnd').value;
    const amountMin = document.getElementById('advAmountMin').value;
    const amountMax = document.getElementById('advAmountMax').value;
    
    const statusSelect = document.getElementById('advStatus');
    const selectedStatuses = Array.from(statusSelect.selectedOptions).map(opt => opt.value).filter(v => v);
    const status = selectedStatuses.join(',');

    const asegurado = document.getElementById('advAsegurado').value.trim();
    const ciaCausante = document.getElementById('advCiaCausante').value.trim();
    const tipoDano = document.getElementById('advTipoDano').value.trim();

    const resultsContainer = document.getElementById('searchResults');
    if (resultsContainer) resultsContainer.style.display = 'none';

    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (!session) throw new Error('No hay sesión activa');

        const params = new URLSearchParams();
        if (dateStart) params.append('fecha_desde', dateStart);
        if (dateEnd) params.append('fecha_hasta', dateEnd);
        if (amountMin) params.append('importe_min', amountMin);
        if (amountMax) params.append('importe_max', amountMax);
        if (status) params.append('estado', status);
        if (asegurado) params.append('asegurado', asegurado);
        if (ciaCausante) params.append('cia_causante', ciaCausante);
        if (tipoDano) params.append('tipo_dano', tipoDano);

        const response = await fetch(`/api/expedientes?${params.toString()}`, {
            headers: { 'Authorization': `Bearer ${session.access_token}` }
        });

        if (!response.ok) throw new Error('Error en la búsqueda avanzada');
        const result = await response.json();

        renderSearchResults(result.data);
        
    } catch (error) {
        console.error('Error en búsqueda avanzada:', error);
        showToast('danger', 'Error', error.message);
    } finally {
        hideLoading();
    }
}

async function addNewTask() {
    console.log('Función addNewTask llamada');
    
    // Resetear formulario
    const form = document.getElementById('taskForm');
    if (form) form.reset();
    
    document.getElementById('taskId').value = '';
    document.getElementById('char-count').textContent = '0';
    document.getElementById('archive-option').classList.add('d-none');
    
    // Configurar campo para Nº SGR (Reemplaza Nº Siniestro)
    const expInput = document.getElementById('taskExpedient');
    const expLabel = document.querySelector("label[for='taskExpedient']");
    if (expLabel) expLabel.textContent = "Nº SGR";
    if (expInput) {
        expInput.placeholder = "Ingrese Nº SGR";
        delete expInput.dataset.siniestro; // Limpiar referencia previa
    }

    // Cargar responsables en el select
    const respSelect = document.getElementById('taskResponsible');
    if (respSelect) {
        // Asegurar que tenemos datos de usuarios cargados desde el backend
        if (!usersData || usersData.length === 0) {
            try {
                const session = await supabaseClient.auth.getSession();
                if (session?.data?.session?.access_token) {
                    const response = await fetch('/api/responsables', {
                        headers: { 'Authorization': `Bearer ${session.data.session.access_token}` }
                    });
                    if (response.ok) {
                        const result = await response.json();
                        usersData = Array.isArray(result) ? result : (result.data || []);
                    }
                }
            } catch (e) {
                console.warn('Error cargando responsables en modal:', e);
            }
        }

        respSelect.innerHTML = '<option value="">Seleccionar...</option>';
        
        // Intentar usar usersData si está cargado, si no responsiblesData
        const sourceData = (usersData && usersData.length > 0) ? usersData : responsiblesData;
        
        sourceData.forEach(user => {
            const opt = document.createElement('option');
            // Ajustar según la estructura de datos (usersData tiene full_name, responsiblesData tiene name)
            const name = user.full_name || user.name || user.email;
            opt.value = name;
            opt.textContent = name;
            respSelect.appendChild(opt);
        });
    }

    const modal = document.getElementById('taskModal');
    if (modal) {
        modal.classList.add('active');
    }
}
async function saveTask() {
    console.log('Función saveTask llamada');

    const id = document.getElementById('taskId').value;
    const sgrInput = document.getElementById('taskExpedient').value.trim();
    const storedSiniestro = document.getElementById('taskExpedient').dataset.siniestro;
    
    const taskData = {
        // num_siniestro se calculará abajo
        responsable: document.getElementById('taskResponsible').value,
        descripcion: document.getElementById('taskDescription').value,
        prioridad: document.getElementById('taskPriority').value,
        fecha_limite: document.getElementById('taskDueDate').value,
        estado: document.getElementById('taskStatus').value,
        importe_recobrado: parseFloat(document.getElementById('taskRecobrado')?.value || 0)
    };

    if (!sgrInput || !taskData.descripcion || !taskData.fecha_limite) {
        showToast('warning', 'Datos incompletos', 'Por favor complete los campos obligatorios.');
        return;
    }

    showLoading();
    try {
        let numSiniestroFinal = storedSiniestro;

        // Lógica para manejar SGR y Siniestro
        if (id && storedSiniestro) {
            // EDICIÓN: Actualizar el SGR del expediente existente
            const { error: expError } = await supabaseClient
                .from('expedientes')
                .update({ num_sgr: sgrInput })
                .eq('num_siniestro', storedSiniestro);
            
            if (expError) {
                console.warn('Error actualizando SGR en expediente:', expError);
                // No bloqueamos el guardado de la tarea, pero avisamos
            }
        } else {
            // CREACIÓN: Buscar expediente por SGR
            const { data: exp, error: findError } = await supabaseClient
                .from('expedientes')
                .select('num_siniestro')
                .eq('num_sgr', sgrInput)
                .single();
            
            if (findError || !exp) {
                throw new Error(`No se encontró ningún expediente con el Nº SGR: ${sgrInput}`);
            }
            numSiniestroFinal = exp.num_siniestro;
        }

        // Asignar el siniestro correcto a la tarea
        taskData.num_siniestro = numSiniestroFinal;

        let error;
        if (id) {
            // Actualizar
            const { error: updateError } = await supabaseClient
                .from('seguimientos')
                .update(taskData)
                .eq('id', id);
            error = updateError;
        } else {
            // Insertar
            const { error: insertError } = await supabaseClient
                .from('seguimientos')
                .insert([taskData]);
            error = insertError;
        }

        if (error) throw error;

        // LÓGICA DE ARCHIVADO AUTOMÁTICO: Si la tarea se marca con un estado final,
        // el expediente asociado debe ser archivado usando el endpoint del servidor.
        const finalStates = ['Completada', 'Finalizado', 'Finalizado Parcial', 'Rehusado', 'Datos NO válidos', 'Recobrado'];
        if (finalStates.includes(taskData.estado)) {
            if (numSiniestroFinal) {
                // 1. Encontrar el ID del expediente a partir del número de siniestro
                const { data: exp, error: findError } = await supabaseClient
                    .from('expedientes')
                    .select('id')
                    .eq('num_siniestro', numSiniestroFinal)
                    .maybeSingle();

                if (findError) {
                    console.warn('No se pudo encontrar el expediente para archivar:', findError.message);
                } else if (exp) {
                    // 2. Llamar al endpoint de archivado del servidor
                    const { data: { session } } = await supabaseClient.auth.getSession();
                    if (session) {
                        const response = await fetch(`/api/expedientes/${exp.id}/archive`, {
                            method: 'POST',
                            headers: { 
                                'Authorization': `Bearer ${session.access_token}`,
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({ motivo: taskData.estado }) // Pasar el estado de la tarea como motivo
                        });
                        if (!response.ok) console.error('Error archivando expediente desde el servidor:', await response.text());
                    }
                }
            }
        }

        showToast('success', 'Éxito', 'Tarea guardada correctamente');
        closeModal('taskModal');
        loadTasks(); // Recargar lista

    } catch (err) {
        console.error('Error saving task:', err);
        showToast('danger', 'Error', 'No se pudo guardar la tarea: ' + err.message);
    } finally {
        hideLoading();
    }
}

async function loadTasks() {
    console.log('Cargando tareas...');
    const tableBody = document.getElementById('tasksTable');
    if (!tableBody) return;

    showLoading();
    
    try {
        // 1. Consultar TAREAS (Sin JOIN para evitar error de FK inexistente)
        // OPTIMIZACIÓN: Seleccionar solo columnas necesarias para reducir transferencia de datos
        let query = supabaseClient
            .from('seguimientos')
            .select('id, num_siniestro, descripcion, responsable, estado, prioridad, fecha_limite, importe_recobrado', { count: 'exact' });
        
        // FILTRO POR ROL (Usuario solo ve sus tareas, Admin ve todo)
        if (currentUser && !currentUser.isAdmin) {
            const userIdentifier = currentUser.name;
            query = query.or(`responsable.eq.${currentUser.name},responsable.eq.${currentUser.email}`);
        }
        
        // Aplicar filtros activos
        if (activeTaskFilters.responsable) query = query.eq('responsable', activeTaskFilters.responsable);
        if (activeTaskFilters.estado) query = query.eq('estado', activeTaskFilters.estado);
        if (activeTaskFilters.prioridad) query = query.eq('prioridad', activeTaskFilters.prioridad);
        
        // Filtro de búsqueda por texto (Nº Siniestro, Descripción o Nº SGR)
        const searchInput = document.getElementById('taskSearchInput');
        const searchTerm = searchInput ? searchInput.value.trim() : '';
        
        if (searchTerm) {
            // Búsqueda mejorada: Incluir búsqueda por SGR (que está en tabla expedientes)
            let sgrSiniestros = [];
            
            // Intentamos buscar coincidencias en expedientes por SGR
            const { data: sgrMatches } = await supabaseClient
                .from('expedientes')
                .select('num_siniestro')
                .ilike('num_sgr', `%${searchTerm}%`)
                .limit(20); // Límite para evitar URLs gigantes
                
            if (sgrMatches && sgrMatches.length > 0) {
                sgrSiniestros = sgrMatches.map(e => e.num_siniestro);
            }

            // Construir query OR: Descripción OR Siniestro OR (Siniestros encontrados por SGR)
            let orConditions = [`num_siniestro.ilike.%${searchTerm}%`, `descripcion.ilike.%${searchTerm}%`];
            if (sgrSiniestros.length > 0) {
                // Añadimos cada siniestro encontrado como una condición EQ
                sgrSiniestros.forEach(sin => orConditions.push(`num_siniestro.eq.${sin}`));
            }
            
            query = query.or(orConditions.join(','));
        }

        const from = (currentTaskPage - 1) * TASKS_PER_PAGE;
        const to = from + TASKS_PER_PAGE - 1;
        
        const { data: tasks, count, error } = await query
            .order('fecha_limite', { ascending: true })
            .range(from, to);
        
        if (error) throw error;

        // 2. Consultar EXPEDIENTES relacionados manualmente (Join en memoria)
        // Esto evita el error PGRST200 si no hay Foreign Key definida en la base de datos
        let tasksWithExpedientes = tasks || [];
        
        if (tasks && tasks.length > 0) {
            const siniestros = tasks.map(t => t.num_siniestro).filter(n => n);
            
            if (siniestros.length > 0) {
                // Intentamos obtener datos extra. Usamos try/catch por si falta alguna columna
                try {
                    const { data: exps } = await supabaseClient
                        .from('expedientes')
                        .select('num_siniestro, num_sgr, referencia_gescon') 
                        .in('num_siniestro', siniestros);

                    if (exps) {
                        const expMap = new Map(exps.map(e => [e.num_siniestro, e]));
                        tasksWithExpedientes = tasks.map(t => {
                            const exp = expMap.get(t.num_siniestro);
                            return {
                                ...t,
                                expedientes: exp ? { 
                                    referencia_gescon: exp.referencia_gescon, 
                                    num_sgr: exp.num_sgr 
                                } : null
                            };
                        });
                    }
                } catch (err) {
                    console.warn('No se pudieron cargar detalles extra de expedientes:', err);
                }
            }
        }
        
        tableBody.innerHTML = '';
        
        if (!tasksWithExpedientes || tasksWithExpedientes.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="11" class="text-center p-4">No hay tareas registradas.</td></tr>';
        } else {
            const todayStr = new Date().toISOString().split('T')[0];
            
            tasksWithExpedientes.forEach(task => {
                const row = document.createElement('tr');
                
                // --- LÓGICA DE ESTILOS Y ESTADOS ---
                let rowClass = '';
                let dateClass = '';
                let recobradoClass = 'cell-recobrado';
                
                const estado = task.estado || '';
                const fechaLimite = task.fecha_limite ? task.fecha_limite.split('T')[0] : '';
                
                // 1. Colores por Estado
                if (estado === 'Pdte. revisión') rowClass = 'task-row-pdte-revision';
                else if (estado === 'Iniciada' || estado === 'En Proceso') rowClass = 'task-row-iniciada';
                else if (estado === 'Completada' || estado === 'Finalizado') rowClass = 'task-row-finalizado';
                else if (estado === 'Finalizado Parcial') rowClass = 'task-row-finalizado-parcial';
                else if (estado === 'Rehusado' || estado === 'Rehusado NO cobertura') rowClass = 'task-row-rehusado';
                else if (estado === 'Datos NO válidos') rowClass = 'task-row-datos-no-validos';
                
                // 2. Lógica de Fecha (Si coincide con HOY -> Rojo)
                if (fechaLimite === todayStr) {
                    dateClass = 'cell-date-today';
                }
                
                // 3. Obtener referencia_gescon desde el JOIN
                const referenciaGescon = task.expedientes?.referencia_gescon || '-';
                const numSGR = task.expedientes?.num_sgr || '';
                
                // 4. Extraer solo el NOMBRE del responsable (sin @email)
                let responsableNombre = task.responsable || '-';
                if (responsableNombre.includes('@')) {
                    // Si es email, extraer la parte antes de @
                    responsableNombre = responsableNombre.split('@')[0];
                }
                
                // 5. Importe recobrado
                const importeRecobrado = task.importe_recobrado 
                    ? new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(task.importe_recobrado) 
                    : '-';
                
                row.className = rowClass;
                row.innerHTML = `
                    <td><input type="checkbox" value="${task.id}"></td>
                    <td>${task.num_siniestro || '-'}</td>
                    <td>${referenciaGescon}</td>
                    <td>${numSGR}</td>
                    <td contenteditable="true" data-field="descripcion" data-id="${task.id}">${task.descripcion || ''}</td>
                    <td>${responsableNombre}</td>
                    <td><span class="status-badge status-${getStatusClass(task.estado)}">${task.estado}</span></td>
                    <td><span class="priority-indicator priority-${task.prioridad.toLowerCase()}">${task.prioridad}</span></td>
                    <td><span class="${dateClass}">${formatDate(task.fecha_limite)}</span></td>
                    <td class="${recobradoClass}">${importeRecobrado}</td>
                    <td>
                        <button class="btn btn-sm btn-outline-primary" onclick="editTask('${task.id}')"><i class="bi bi-pencil"></i></button>
                    </td>
                `;
                tableBody.appendChild(row);
            });
            
            // PAGINACIÓN: Implementar tras cargar
            renderTaskPagination(count || 0);
        }
    } catch (error) {
        console.error('Error loading tasks:', error);
        let errorMsg = 'No se pudieron cargar las tareas.';
        
        if (error.code === 'PGRST205') errorMsg = 'La tabla "tareas" no existe en Supabase. Ejecuta el script SQL.';
        else if (error.code === 'PGRST200') errorMsg = 'Error de relación (FK) entre tablas.';
        else errorMsg += ` (${error.message})`;

        tableBody.innerHTML = `<tr><td colspan="11" class="text-center text-danger"><i class="bi bi-exclamation-triangle"></i> ${errorMsg}</td></tr>`;
    } finally {
        hideLoading();
    }
}

async function editTask(id) {
    console.log('Editar tarea:', id);
    showLoading();

    try {
        const { data: task, error } = await supabaseClient
            .from('seguimientos')
            .select('*')
            .eq('id', id)
            .single();

        if (error) throw error;

        // Reset form
        const form = document.getElementById('taskForm');
        if (form) form.reset();

        document.getElementById('taskId').value = task.id;
        document.getElementById('taskDescription').value = task.descripcion || '';
        document.getElementById('taskPriority').value = task.prioridad || 'Media';
        document.getElementById('taskStatus').value = task.estado || 'Pendiente';
        const recobradoInput = document.getElementById('taskRecobrado');
        if (recobradoInput) recobradoInput.value = task.importe_recobrado || '';
        
        if (task.fecha_limite) {
            document.getElementById('taskDueDate').value = task.fecha_limite.split('T')[0];
        }

        // Handle SGR/Siniestro
        const expInput = document.getElementById('taskExpedient');
        const expLabel = document.querySelector("label[for='taskExpedient']");
        if (expLabel) expLabel.textContent = "Nº SGR";
        
        if (expInput) {
            let sgrValue = '';
            if (task.num_siniestro) {
                const { data: exp } = await supabaseClient
                    .from('expedientes')
                    .select('num_sgr')
                    .eq('num_siniestro', task.num_siniestro)
                    .maybeSingle();
                if (exp) sgrValue = exp.num_sgr;
            }
            expInput.value = sgrValue || task.num_siniestro || '';
            expInput.dataset.siniestro = task.num_siniestro;
        }

        // Char count
        const charCount = document.getElementById('char-count');
        if (charCount) charCount.textContent = (task.descripcion || '').length;

        // Load responsibles
        const respSelect = document.getElementById('taskResponsible');
        if (respSelect) {
            if (!usersData || usersData.length === 0) {
                try {
                    const session = await supabaseClient.auth.getSession();
                    if (session?.data?.session?.access_token) {
                        const response = await fetch('/api/responsables', {
                            headers: { 'Authorization': `Bearer ${session.data.session.access_token}` }
                        });
                        if (response.ok) {
                            const result = await response.json();
                            usersData = Array.isArray(result) ? result : (result.data || []);
                        }
                    }
                } catch (e) { console.warn(e); }
            }

            respSelect.innerHTML = '<option value="">Seleccionar...</option>';
            const sourceData = (usersData && usersData.length > 0) ? usersData : responsiblesData;
            
            sourceData.forEach(user => {
                const opt = document.createElement('option');
                const name = user.full_name || user.name || user.email;
                opt.value = name;
                opt.textContent = name;
                respSelect.appendChild(opt);
            });

            respSelect.value = task.responsable || '';
        }
        
        // Show modal
        const modal = document.getElementById('taskModal');
        if (modal) modal.classList.add('active');
        
    } catch (error) {
        console.error(error);
        showToast('danger', 'Error', 'No se pudo cargar la tarea');
    } finally {
        hideLoading();
    }
}

async function filterTasks() {
    console.log('Función filterTasks llamada');
    
    // Cargar responsables en el select del filtro
    const respSelect = document.getElementById('filterTaskResponsible');
    if (respSelect) {
        // Asegurar que tenemos datos de usuarios cargados
        if (!usersData || usersData.length === 0) {
            try {
                const session = await supabaseClient.auth.getSession();
                if (session?.data?.session?.access_token) {
                    const response = await fetch('/api/responsables', {
                        headers: { 'Authorization': `Bearer ${session.data.session.access_token}` }
                    });
                    if (response.ok) {
                        const result = await response.json();
                        usersData = Array.isArray(result) ? result : (result.data || []);
                    }
                }
            } catch (e) {
                console.warn('Error cargando responsables en modal (filter):', e);
            }
        }

        respSelect.innerHTML = '<option value="">Todos</option>';
        
        // Usar usersData si está disponible, sino responsiblesData
        const sourceData = (usersData && usersData.length > 0) ? usersData : responsiblesData;
        
        sourceData.forEach(user => {
            const opt = document.createElement('option');
            const name = user.full_name || user.name || user.email;
            opt.value = name;
            opt.textContent = name;
            respSelect.appendChild(opt);
        });

        // Restaurar selección previa
        if (activeTaskFilters.responsable) {
            respSelect.value = activeTaskFilters.responsable;
        }
    }

    // Restaurar otros filtros
    if (document.getElementById('filterTaskStatus')) document.getElementById('filterTaskStatus').value = activeTaskFilters.estado || '';
    if (document.getElementById('filterTaskPriority')) document.getElementById('filterTaskPriority').value = activeTaskFilters.prioridad || '';

    const modal = document.getElementById('filterTasksModal');
    if (modal) modal.classList.add('active');
}

function applyTaskFilters() {
    activeTaskFilters = {
        responsable: document.getElementById('filterTaskResponsible').value,
        estado: document.getElementById('filterTaskStatus').value,
        prioridad: document.getElementById('filterTaskPriority').value
    };
    currentTaskPage = 1; // Resetear paginación al filtrar
    closeModal('filterTasksModal');
    loadTasks();
    showToast('info', 'Filtros aplicados', 'Lista de tareas actualizada.');
}

function clearTaskFilters() {
    activeTaskFilters = {};
    currentTaskPage = 1; // Resetear paginación al limpiar
    closeModal('filterTasksModal');
    loadTasks();
    showToast('info', 'Filtros limpiados', 'Se muestran todas las tareas.');
}

async function loadDuplicates() {
    console.log('Cargando duplicados...');
    const tableBody = document.getElementById('duplicatesTable');
    if (!tableBody) return;

    showLoading();
    try {
        const { data: duplicates, error } = await supabaseClient
            .from('duplicados')
            .select('*')
            .order('fecha_deteccion', { ascending: false });

        if (error) throw error;

        duplicatesData = duplicates || [];
        renderDuplicatesTable();
    } catch (error) {
        if (error.code === 'PGRST205') {
            tableBody.innerHTML = '<tr><td colspan="8" class="text-center text-muted">La tabla "duplicados" no existe. Ejecuta el script SQL de configuración.</td></tr>';
        } else {
            console.error('Error loading duplicates:', error);
            tableBody.innerHTML = `<tr><td colspan="8" class="text-center text-danger">Error al cargar duplicados: ${error.message}</td></tr>`;
        }
    } finally {
        hideLoading();
    }
}

function renderDuplicatesTable() {
    const tableBody = document.getElementById('duplicatesTable');
    if (!tableBody) return;
    
    tableBody.innerHTML = '';
    
    if (!duplicatesData || duplicatesData.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="8" class="text-center p-4">No se encontraron expedientes duplicados pendientes de revisión.</td></tr>';
        return;
    }

    duplicatesData.forEach(dup => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td><input type="checkbox" class="duplicate-checkbox" value="${dup.id}"></td>
            <td>${dup.num_siniestro || '-'}</td>
            <td>${dup.num_sgr || '-'}</td>
            <td>${dup.nombre_asegurado || '-'}</td>
            <td>${formatDate(dup.fecha_deteccion)}</td>
            <td>${dup.veces_repetido || 1}</td>
            <td><span class="status-badge status-duplicado">Duplicado</span></td>
            <td>
                <button class="btn btn-sm btn-success" onclick="processDuplicate('${dup.id}')" title="Procesar (Sobrescribir)"><i class="bi bi-check"></i></button>
                <button class="btn btn-sm btn-danger" onclick="deleteDuplicate('${dup.id}')" title="Eliminar"><i class="bi bi-trash"></i></button>
            </td>
        `;
        tableBody.appendChild(row);
    });
}

async function processAllDuplicates() {
    const confirmed = await showConfirmModal(
        'Procesar Todos los Duplicados',
        '¿Procesar y fusionar todos los duplicados detectados?\n\nSe actualizarán los expedientes originales con la información más reciente y se eliminarán los registros de la bandeja de duplicados.',
        'Procesar Todo',
        'btn-primary'
    );
    if (!confirmed) return;
    
    showLoading();
    try {
        const { data: duplicates, error } = await supabaseClient.from('duplicados').select('*');
        if (error) throw error;
        
        if (!duplicates || duplicates.length === 0) {
            showToast('info', 'Sin datos', 'No hay duplicados para procesar.');
            return;
        }

        // Procesar cada duplicado (Upsert en expedientes)
        const processedExpedients = [];
        for (const dup of duplicates) {
            // Excluir created_at para evitar error de columna no existente
            const { id, fecha_deteccion, veces_repetido, created_at, ...expedientData } = dup;
            
            // Upsert basado en num_siniestro
            // FIX: Reemplazar upsert con check/update/insert manual para evitar error de restricción única
            let upsertError = null;
            const { data: existing } = await supabaseClient
                .from('expedientes')
                .select('id')
                .eq('num_siniestro', expedientData.num_siniestro)
                .maybeSingle();

            if (existing) {
                const { error } = await supabaseClient.from('expedientes').update(expedientData).eq('id', existing.id);
                upsertError = error;
            } else {
                const { error } = await supabaseClient.from('expedientes').insert([expedientData]);
                upsertError = error;
            }
                
            if (upsertError) {
                console.error(`Error procesando duplicado ${dup.num_siniestro}:`, upsertError);
            } else {
                processedExpedients.push(expedientData);
            }
        }
        
        // Eliminar todos de la tabla duplicados
        await supabaseClient.from('duplicados').delete().not('id', 'is', null);

        showToast('success', 'Procesado', `Se han procesado ${processedExpedients.length} duplicados.`);
        loadDuplicates();
        loadDashboardStats();
    } catch (error) {
        console.error('Error procesando duplicados:', error);
        showToast('danger', 'Error', error.message);
    } finally {
        hideLoading();
    }
}

async function deleteAllDuplicates() {
    const confirmed = await requestSecurityConfirmation(
        'Eliminar TODOS los Duplicados',
        'PELIGRO: ¿Estás seguro de que deseas eliminar TODOS los duplicados pendientes?\n\nEsta acción no se puede deshacer.',
        'ELIMINAR'
    );

    if (!confirmed) {
        showToast('info', 'Cancelado', 'Operación cancelada.');
        return;
    }

    showLoading();
    try {
        const { error } = await supabaseClient
            .from('duplicados')
            .delete()
            .not('id', 'is', null);

        if (error) throw error;

        showToast('success', 'Eliminados', 'Se han eliminado todos los duplicados pendientes.');
        loadDuplicates();
        loadDashboardStats();
    } catch (error) {
        console.error('Error deleting all duplicates:', error);
        showToast('danger', 'Error', 'Error al eliminar duplicados: ' + error.message);
    } finally {
        hideLoading();
    }
}

async function deleteDuplicate(id) {
    const confirmed = await showConfirmModal(
        'Eliminar Duplicado',
        '¿Eliminar este registro de duplicados?',
        'Eliminar',
        'btn-danger'
    );
    if (!confirmed) return;
    
    showLoading();
    try {
        const { error } = await supabaseClient
            .from('duplicados')
            .delete()
            .eq('id', id);

        if (error) throw error;

        showToast('success', 'Eliminado', 'Registro eliminado.');
        loadDuplicates();
        loadDashboardStats();
    } catch (error) {
        console.error('Error deleting duplicate:', error);
        showToast('danger', 'Error', error.message);
    } finally {
        hideLoading();
    }
}

async function processDuplicate(id) {
    const confirmed = await showConfirmModal(
        'Procesar Duplicado',
        '¿Procesar este duplicado? Se actualizará el expediente original.',
        'Procesar',
        'btn-success'
    );
    if (!confirmed) return;
    
    showLoading();
    try {
        const { data: dup, error: getError } = await supabaseClient
            .from('duplicados')
            .select('*')
            .eq('id', id)
            .single();
            
        if (getError) throw getError;
        
        const { id: dupId, fecha_deteccion, veces_repetido, created_at, ...expedientData } = dup;
        
        const { data: existing } = await supabaseClient
            .from('expedientes')
            .select('id')
            .eq('num_siniestro', expedientData.num_siniestro)
            .maybeSingle();

        if (existing) {
            await supabaseClient.from('expedientes').update(expedientData).eq('id', existing.id);
        } else {
            await supabaseClient.from('expedientes').insert([expedientData]);
        }
        
        await supabaseClient.from('duplicados').delete().eq('id', id);
        
        showToast('success', 'Procesado', 'Duplicado procesado correctamente.');
        loadDuplicates();
        loadDashboardStats();
    } catch (error) {
        console.error('Error processing duplicate:', error);
        showToast('danger', 'Error', error.message);
    } finally {
        hideLoading();
    }
}

// ===============================
// GESTIÓN DE RESPONSABLES (ADMIN)
// ===============================

// Datos de ejemplo de responsables (se sustituirán por datos reales desde Supabase/backend)
let responsiblesData = [
  { id: 1, name: 'Juan Pérez',   email: 'juan.perez@empresa.com',   status: 'available', distribution: 'yes', activeTasks: 5, completedTasks: 23 },
  { id: 2, name: 'María López',  email: 'maria.lopez@empresa.com',  status: 'vacation', distribution: 'no',  activeTasks: 0, completedTasks: 18, returnDate: '2024-12-20' },
  { id: 3, name: 'Carlos Rodríguez', email: 'carlos.rodriguez@empresa.com', status: 'available', distribution: 'yes', activeTasks: 3, completedTasks: 31 },
  { id: 4, name: 'Ana Martínez', email: 'ana.martinez@empresa.com', status: 'sick',      distribution: 'no',  activeTasks: 0, completedTasks: 15, returnDate: '2024-12-15' }
];

// Función para cargar responsables (se ejecuta al entrar en la sección 'admin' desde showSection)
// Función para cargar responsables
async function loadResponsibles() {
  console.log('Cargando responsables...');
  showLoading();
  const container = document.getElementById('responsiblesList');
  if (container) container.innerHTML = '<div class="text-center"><div class="spinner-border text-primary" role="status"></div></div>';

  try {
    // Usar WorkloadAPI para obtener estadísticas completas
    const result = await workloadAPI.getStats();
    
    // FIX: Extraer el array correcto - Validación robusta
    const stats = Array.isArray(result) ? result : (Array.isArray(result?.data) ? result.data : []);
    
    renderResponsiblesTable(stats);
    
    // Actualizar timestamp si existe elemento
    const lastUpdate = document.getElementById('ultima-actualizacion');
    if (lastUpdate && !Array.isArray(result) && result.timestamp) {
        lastUpdate.textContent = new Date(result.timestamp).toLocaleTimeString();
    }
  } catch (error) {
    console.error('Error loading responsibles:', error);
    showToast('danger', 'Error', error.message);
    if (container) container.innerHTML = '<div class="alert alert-danger">Error al cargar responsables</div>';
  } finally {
    hideLoading();
  }
}

function renderResponsiblesTable(stats) {
    const container = document.getElementById('responsiblesList');
    if (!container) return;

    container.innerHTML = '';

    // FIX: Validación más robusta
    if (!Array.isArray(stats) || stats.length === 0) {
        container.innerHTML = '<div class="alert alert-info">No hay responsables registrados.</div>';
        return;
    }

    const table = document.createElement('table');
    table.className = 'table table-hover align-middle';
    table.innerHTML = `
        <thead>
            <tr>
                <th>Nombre</th>
                <th>Email</th>
                <th>Estado</th>
                <th>Tareas Activas</th>
                <th>Completadas</th>
                <th>Importe Total</th>
                <th>Acciones</th>
            </tr>
        </thead>
        <tbody></tbody>
    `;
    const tbody = table.querySelector('tbody');
    
    // Mapeo de estados para UI
    const statusMap = { 'active': 'Activo', 'inactive': 'Inactivo', 'vacation': 'Vacaciones', 'sick_leave': 'Baja Médica', 'permit': 'Permiso' };
    const classMap = { 'active': 'bg-success', 'inactive': 'bg-secondary', 'vacation': 'bg-warning text-dark', 'sick_leave': 'bg-danger', 'permit': 'bg-info text-dark' };

    stats.forEach(stat => {
        // Validación adicional por si algún elemento no es válido
        if (!stat || typeof stat !== 'object') return;
        
        const name = stat.user_name || stat.email;
        const statusLabel = statusMap[stat.status] || stat.status;
        const statusClass = classMap[stat.status] || 'bg-secondary';
        const importe = stat.importe_total ? new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(stat.importe_total) : '€0,00';
        
        // Determinar acción (Activar/Desactivar)
        const isInactive = ['inactive', 'vacation', 'sick_leave'].includes(stat.status);
        const actionBtnClass = isInactive ? 'btn-success' : 'btn-warning';
        const actionIcon = isInactive ? 'bi-play-fill' : 'bi-pause-fill';
        const actionText = isInactive ? 'Activar' : 'Inactivar';
        const actionFn = isInactive ? 'activateUser' : 'deactivateUser';
        
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${name}</td>
            <td>${stat.email}</td>
            <td><span class="badge ${statusClass}">${statusLabel}</span></td>
            <td>${stat.tareas_activas || 0}</td>
            <td>${stat.tareas_completadas || 0}</td>
            <td>${importe}</td>
            <td>
                <button onclick="toggleUsuarioEstado('${stat.user_id}', '${actionFn}')" class="btn btn-sm ${actionBtnClass}">
                    <i class="bi ${actionIcon}"></i> ${actionText}
                </button>
            </td>
        `;
        tbody.appendChild(row);
    });

    container.appendChild(table);
}

async function toggleUsuarioEstado(userId, action) {
    try {
        showLoading();
        let response;
        
        if (action === 'activateUser') {
            response = await workloadAPI.activateUser(userId);
        } else {
            response = await workloadAPI.deactivateUser(userId);
        }

        if (response.success) {
            showToast('success', 'Éxito', response.message);
            await loadResponsibles(); // Recargar tabla
        } else {
            throw new Error(response.error || 'Error desconocido');
        }
    } catch (error) {
        console.error('Error toggling user status:', error);
        showToast('danger', 'Error', error.message);
    } finally {
        hideLoading();
    }
}

async function loadUsers() {
    console.log('Cargando usuarios...');
    showLoading();
    const container = document.getElementById('usersList');
    if (container) container.innerHTML = '<div class="text-center"><div class="spinner-border text-primary" role="status"></div></div>';

    try {
        const session = await supabaseClient.auth.getSession();
        if (!session?.data?.session?.access_token) throw new Error('No hay sesión activa');

        // CORRECCIÓN OPTIMIZACIÓN 4: Usar endpoint de administración completo
        const response = await fetch('/admin/users', {
            headers: { 'Authorization': `Bearer ${session.data.session.access_token}` }
        });

        if (!response.ok) throw new Error('Error cargando usuarios');
        const result = await response.json();
        // FIX: Validación robusta y evitar duplicados
        const users = Array.isArray(result) ? result : (Array.isArray(result?.data) ? result.data : []);
        usersData = users;

        renderUsersTable(users);
    } catch (error) {
        console.error('Error loading users:', error);
        showToast('danger', 'Error', error.message);
        if (container) container.innerHTML = '<div class="alert alert-danger">Error al cargar usuarios</div>';
    } finally {
        hideLoading();
    }
}

function renderUsersTable(users) {
    const container = document.getElementById('usersList');
    if (!container) return;

    container.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'd-flex justify-content-end mb-3';
    header.innerHTML = `<button class="btn btn-primary" onclick="createNewUser()"><i class="bi bi-person-plus"></i> Nuevo Usuario</button>`;
    container.appendChild(header);

    if (!users || users.length === 0) {
        const alert = document.createElement('div');
        alert.className = 'alert alert-info';
        alert.textContent = 'No hay usuarios registrados.';
        container.appendChild(alert);
        return;
    }

    const table = document.createElement('table');
    table.className = 'table table-hover';
    table.innerHTML = `
        <thead>
            <tr>
                <th>Nombre</th>
                <th>Email</th>
                <th>Estado</th>
                <th>Acciones</th>
            </tr>
        </thead>
        <tbody></tbody>
    `;
    const tbody = table.querySelector('tbody');

    const statusMap = { 'active': 'Activo', 'inactive': 'Inactivo', 'vacation': 'Vacaciones', 'sick_leave': 'Baja Médica', 'permit': 'Permiso' };
    const classMap = { 'active': 'bg-success', 'inactive': 'bg-secondary', 'vacation': 'bg-warning text-dark', 'sick_leave': 'bg-danger', 'permit': 'bg-info text-dark' };

    users.forEach(user => {
        const name = user.full_name || user.email;
        const statusLabel = statusMap[user.status] || user.status;
        const statusClass = classMap[user.status] || 'bg-secondary';
        
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${name}</td>
            <td>${user.email}</td>
            <td><span class="badge ${statusClass}">${statusLabel}</span></td>
            <td>
                <button class="btn btn-sm btn-outline-primary" onclick="editUser('${user.id}')" title="Editar Usuario">
                    <i class="bi bi-pencil"></i>
                </button>
            </td>
        `;
        tbody.appendChild(row);
    });

    container.appendChild(table);
}

function editUser(id) {
    const user = usersData.find(u => u.id === id);
    if (!user) {
        showToast('danger', 'Error', 'Usuario no encontrado');
        return;
    }

    const modalEl = getOrCreateUserModal();
    document.getElementById('userForm').reset();

    document.getElementById('userId').value = user.id;
    document.getElementById('userEmail').value = user.email;
    document.getElementById('userFullName').value = user.full_name || '';
    document.getElementById('userRole').value = user.role || 'user';
    document.getElementById('userModalTitle').textContent = 'Editar Usuario';
    document.getElementById('passwordHelp').classList.remove('d-none');
    document.getElementById('userPassword').required = false;

    const modal = new bootstrap.Modal(modalEl);
    modal.show();
}

function getOrCreateUserModal() {
    let modalEl = document.getElementById('userModal');
    if (!modalEl) {
        const modalHtml = `
        <div class="modal fade" id="userModal" tabindex="-1" aria-hidden="true">
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title" id="userModalTitle">Nuevo Usuario</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <div class="modal-body">
                        <form id="userForm">
                            <input type="hidden" id="userId">
                            <div class="mb-3">
                                <label for="userEmail" class="form-label">Email</label>
                                <input type="email" class="form-control" id="userEmail" required>
                            </div>
                            <div class="mb-3">
                                <label for="userPassword" class="form-label">Contraseña</label>
                                <input type="password" class="form-control" id="userPassword">
                                <div id="passwordHelp" class="form-text d-none">Dejar en blanco para mantener la actual.</div>
                            </div>
                            <div class="mb-3">
                                <label for="userFullName" class="form-label">Nombre Completo</label>
                                <input type="text" class="form-control" id="userFullName" required>
                            </div>
                            <div class="mb-3">
                                <label for="userRole" class="form-label">Rol</label>
                                <select class="form-select" id="userRole">
                                    <option value="user">Usuario</option>
                                    <option value="admin">Administrador</option>
                                </select>
                            </div>
                        </form>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
                        <button type="button" class="btn btn-primary" onclick="saveUser()">Guardar</button>
                    </div>
                </div>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        modalEl = document.getElementById('userModal');
    }
    return modalEl;
}

function createNewUser() {
    const modalEl = getOrCreateUserModal();
    const form = document.getElementById('userForm');
    form.reset();
    
    document.getElementById('userId').value = '';
    document.getElementById('userModalTitle').textContent = 'Nuevo Usuario';
    
    const pwdInput = document.getElementById('userPassword');
    pwdInput.required = true;
    document.getElementById('passwordHelp').classList.add('d-none');

    const modal = new bootstrap.Modal(modalEl);
    modal.show();
}

async function saveUser() {
    const id = document.getElementById('userId').value;
    const email = document.getElementById('userEmail').value;
    const password = document.getElementById('userPassword').value;
    const fullName = document.getElementById('userFullName').value;
    const role = document.getElementById('userRole').value;

    if (!email || !fullName) {
        showToast('warning', 'Datos incompletos', 'Email y Nombre son obligatorios.');
        return;
    }
    if (!id && !password) {
        showToast('warning', 'Datos incompletos', 'La contraseña es obligatoria para nuevos usuarios.');
        return;
    }

    const userData = { email, full_name: fullName, role };
    if (password) userData.password = password;
    
    showLoading();
    try {
        const session = await supabaseClient.auth.getSession();
        const token = session?.data?.session?.access_token;
        if (!token) throw new Error('No hay sesión activa');

        const url = id ? `/api/users/${id}` : '/api/users';
        const method = id ? 'PUT' : 'POST';

        const response = await fetch(url, {
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(userData)
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.error || 'Error al guardar usuario');
        }

        showToast('success', 'Éxito', id ? 'Usuario actualizado correctamente' : 'Usuario creado correctamente');
        
        const modalEl = document.getElementById('userModal');
        const modal = bootstrap.Modal.getInstance(modalEl);
        modal.hide();
        
        loadUsers();
    } catch (error) {
        console.error('Error saving user:', error);
        showToast('danger', 'Error', error.message);
    } finally {
        hideLoading();
    }
}

function resetWorkloadConfig() {
    console.log('Función resetWorkloadConfig llamada');
    showToast('info', 'Restablecido', 'La configuración de carga de trabajo ha sido restablecida a sus valores predeterminados.');
}

function saveWorkloadConfig() {
    console.log('Función saveWorkloadConfig llamada');
    showToast('success', 'Guardado', 'La configuración de carga de trabajo ha sido guardada correctamente (simulado).');
}

/**
 * Inicia el proceso de rebalanceo de carga de trabajo, con una simulación opcional.
 * Llama al endpoint del backend para ejecutar la lógica de negocio.
 * @param {boolean} isSimulation - Si es true, solo simula el rebalanceo. Si es false, lo ejecuta.
 */
async function rebalanceActiveWorkload(isSimulation = false) {
    const mode = isSimulation ? 'simulate' : 'execute';
    const title = isSimulation ? 'Simular Rebalanceo de Carga' : 'Ejecutar Rebalanceo de Carga';
    const message = isSimulation 
        ? '¿Deseas simular un rebalanceo de carga? No se moverán tareas, solo se mostrará el resultado de la redistribución.'
        : '<strong>PELIGRO:</strong> ¿Estás seguro de que deseas ejecutar el rebalanceo de carga?<br><br>Las tareas se moverán entre los usuarios activos para nivelar la carga de trabajo. Esta acción no se puede deshacer.';
    const confirmText = isSimulation ? 'Simular' : 'Ejecutar Rebalanceo';
    const confirmClass = isSimulation ? 'btn-info' : 'btn-danger';

    const confirmed = await showConfirmModal(title, message, confirmText, confirmClass);
    if (!confirmed) {
        showToast('info', 'Cancelado', 'La operación de rebalanceo ha sido cancelada.');
        return;
    }

    showLoading();
    const spinner = document.getElementById('workloadSpinner');
    if (spinner) spinner.classList.remove('d-none');

    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (!session) throw new Error('No hay sesión activa');

        // Usar el nuevo servicio para ejecución real, mantener endpoint admin para simulación
        const endpoint = isSimulation 
            ? `/admin/rebalance-workload?mode=${mode}` 
            : '/api/workload/rebalance';

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${session.access_token}` }
        });

        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Error en el servidor durante el rebalanceo');

        showToast(isSimulation ? 'info' : 'success', 'Rebalanceo', result.message);
        
        if (!isSimulation) await loadWorkloadStats();
    } catch (error) {
        console.error('Error en rebalanceo de carga:', error);
        showToast('danger', 'Error', error.message);
    } finally {
        hideLoading();
        if (spinner) spinner.classList.add('d-none');
    }
}

// ==========================================
// WORKLOAD API CLIENT
// ==========================================

class WorkloadAPI {
  constructor(baseURL) {
    this.baseURL = baseURL || '';
  }

  // Helper para hacer fetch con manejo de errores y auth
  async _fetch(url, options = {}) {
    try {
      const session = await supabaseClient.auth.getSession();
      const token = session?.data?.session?.access_token;
      
      if (!token) throw new Error('No hay sesión activa');

      const response = await fetch(this.baseURL + url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          ...options.headers
        }
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }

      return data;
    } catch (error) {
      console.error(`Error en ${url}:`, error);
      throw error;
    }
  }

  // ===== MÉTODOS DE API =====

  async getStats() {
    return this._fetch('/api/workload/stats');
  }

  async getActiveUsers() {
    return this._fetch('/api/workload/users/active');
  }

  async deactivateUser(userId) {
    return this._fetch(`/api/workload/user/${userId}/deactivate`, { method: 'POST' });
  }

  async activateUser(userId) {
    return this._fetch(`/api/workload/user/${userId}/activate`, { method: 'POST' });
  }

  async distributeToNewUser(userId, percentage = 0.2) {
    return this._fetch(`/api/workload/user/${userId}/distribute-initial`, {
      method: 'POST',
      body: JSON.stringify({ percentage })
    });
  }

  async rebalance() {
    return this._fetch('/api/workload/rebalance', { method: 'POST' });
  }

  async distributeImport(importLogId, expedienteIds) {
    return this._fetch('/api/workload/distribute-import', {
      method: 'POST',
      body: JSON.stringify({ importLogId, expedienteIds })
    });
  }
}

// Instancia global
const workloadAPI = new WorkloadAPI();

// OPTIMIZACIÓN 6: CACHÉ FRONTEND
const workloadCache = {
  data: null,
  timestamp: 0,
  ttl: 30000 // 30 segundos
};

// Función para cargar estadísticas de carga de trabajo
async function loadWorkloadStats() {
    console.log('Cargando estadísticas de carga de trabajo...');
    const tableBody = document.getElementById('workloadTable');
    if (!tableBody) return;

    // INYECCIÓN DE BARRA DE HERRAMIENTAS (Si no existe)
    const table = tableBody.closest('table');
    const wrapper = table ? (table.closest('.table-responsive') || table.parentElement) : null;
    
    if (wrapper && !document.getElementById('workloadToolbar')) {
        const toolbar = document.createElement('div');
        toolbar.id = 'workloadToolbar';
        toolbar.className = 'd-flex justify-content-between align-items-center mb-3 p-2 bg-light rounded border';
        toolbar.innerHTML = `
            <div class="d-flex align-items-center gap-2">
                <h5 class="mb-0 text-primary"><i class="bi bi-graph-up"></i> Carga de Trabajo</h5>
                <small class="text-muted ms-2" id="workloadLastUpdate"></small>
                <div id="workloadSpinner" class="spinner-border spinner-border-sm text-primary d-none" role="status"></div>
            </div>
            <div class="btn-group">
                <button class="btn btn-sm btn-outline-primary" onclick="loadWorkloadStats()" title="Refrescar datos">
                    <i class="bi bi-arrow-clockwise"></i>
                </button>
                <button class="btn btn-sm btn-success" onclick="distributeWorkloadEquitably()" title="Asignar expedientes sin gestor">
                    <i class="bi bi-share-fill"></i> Distribuir Pendientes
                </button>
                <button class="btn btn-sm btn-warning text-dark" onclick="rebalanceActiveWorkload(true)" title="Simular rebalanceo">
                    <i class="bi bi-eye"></i> Simular
                </button>
                <button class="btn btn-sm btn-danger" onclick="rebalanceActiveWorkload(false)" title="Rebalancear carga activa">
                    <i class="bi bi-shuffle"></i> Rebalancear
                </button>
            </div>
        `;
        wrapper.parentNode.insertBefore(toolbar, wrapper);
    }
    const updateLabel = document.getElementById('workloadLastUpdate');
    if (updateLabel) updateLabel.textContent = 'Actualizado: ' + new Date().toLocaleTimeString();

    showLoading();
    try {
        // Verificar caché
        const now = Date.now();
        if (workloadCache.data && (now - workloadCache.timestamp < workloadCache.ttl)) {
            console.log('Usando caché de workload');
            renderWorkloadTable(workloadCache.data, tableBody);
            hideLoading();
            return;
        }

        // Usar el API helper que ya gestiona la autenticación
        const result = await workloadAPI.getStats();
        console.log('Result from API:', result); // Para debugging

        // FIX: Extraer el array correcto - Validación robusta
        const stats = Array.isArray(result) ? result : (Array.isArray(result?.data) ? result.data : []);
        console.log('Processed stats:', stats); // Para debugging
        
        // Actualizar caché
        workloadCache.data = stats;
        workloadCache.timestamp = now;

        renderWorkloadTable(stats, tableBody);

    } catch (error) {
        console.error(error);
        tableBody.innerHTML = '<tr><td colspan="6" class="text-center text-danger">Error al cargar datos</td></tr>';
    } finally {
        hideLoading();
    }
}

function renderWorkloadTable(stats, tableBody) {
    if (!Array.isArray(stats) || stats.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No hay datos de carga de trabajo disponibles.</td></tr>';
        return;
    }

    tableBody.innerHTML = stats.map(user => `
        <tr>
            <td>${user.user_name || user.email}</td>
            <td><span class="status-badge status-${user.status === 'active' ? 'available' : 'unavailable'}">${user.status === 'active' ? 'Activo' : user.status}</span></td>
            <td>${user.tareas_activas || 0}</td>
            <td>${user.tareas_completadas || 0}</td>
            <td>${user.importe_total ? new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(user.importe_total) : '€0,00'}</td>
            <td>
                <span class="badge ${user.tareas_activas > 10 ? 'bg-danger' : 'bg-success'}">
                    ${user.tareas_activas > 10 ? 'Alta Carga' : 'Disponible'}
                </span>
            </td>
        </tr>
    `).join('');
}

function loadSystemLimits() {
    console.log('Cargando límites del sistema...');
    
    // Intentar cargar desde localStorage
    const saved = localStorage.getItem('gescon360_systemLimits');
    if (saved) {
        try {
            systemLimits = { ...systemLimits, ...JSON.parse(saved) };
        } catch (e) {
            console.error('Error parsing saved limits', e);
        }
    }

    // Rellenar inputs
    const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.value = val;
    };

    setVal('maxFileSize', systemLimits.maxFileSize);
    setVal('maxConcurrentFiles', systemLimits.maxConcurrentFiles);
    setVal('maxExpedientes', systemLimits.maxExpedientes);
    setVal('maxActiveTasks', systemLimits.maxActiveTasks);
    setVal('maxArchivedExpedientes', systemLimits.maxArchivedExpedientes);

    updateSystemStatusTable();
}

async function updateSystemStatusTable() {
    const tbody = document.getElementById('limitsTableBody');
    if (!tbody) return;

    // Obtener conteos actuales (simulado o real si es rápido)
    let currentExpedientes = 0;
    let currentTasks = 0;
    let currentArchived = 0;

    try {
        // Consultas ligeras (count)
        const { count: expCount } = await supabaseClient.from('expedientes').select('*', { count: 'exact', head: true }).neq('estado', 'Archivado');
        currentExpedientes = expCount || 0;

        const { count: taskCount } = await supabaseClient.from('seguimientos').select('*', { count: 'exact', head: true }).neq('estado', 'Completada');
        currentTasks = taskCount || 0;

        const { count: archCount } = await supabaseClient.from('expedientes').select('*', { count: 'exact', head: true }).eq('estado', 'Archivado');
        currentArchived = archCount || 0;
    } catch (e) {
        console.warn('Error fetching counts for limits', e);
    }

    const rows = [
        { label: 'Archivos de Importación', limit: `${systemLimits.maxFileSize} MB`, current: 'N/A', percent: 0 },
        { label: 'Expedientes Activos', limit: systemLimits.maxExpedientes, current: currentExpedientes, percent: Math.round((currentExpedientes / systemLimits.maxExpedientes) * 100) },
        { label: 'Tareas Activas', limit: systemLimits.maxActiveTasks, current: currentTasks, percent: Math.round((currentTasks / systemLimits.maxActiveTasks) * 100) },
        { label: 'Expedientes Archivados', limit: systemLimits.maxArchivedExpedientes, current: currentArchived, percent: Math.round((currentArchived / systemLimits.maxArchivedExpedientes) * 100) }
    ];

    tbody.innerHTML = rows.map(r => {
        let statusClass = 'status-available';
        let statusText = 'Normal';
        if (r.percent >= 90) { statusClass = 'status-unavailable'; statusText = 'Crítico'; }
        else if (r.percent >= 75) { statusClass = 'status-pendiente'; statusText = 'Advertencia'; }

        return `
            <tr>
                <td>${r.label}</td>
                <td>${r.limit}</td>
                <td>${r.current}</td>
                <td>${r.percent}%</td>
                <td><span class="status-badge ${statusClass}">${statusText}</span></td>
            </tr>
        `;
    }).join('');
}

async function resetLimits() {
    const confirmed = await showConfirmModal(
        'Restablecer Límites',
        '¿Restablecer los límites a los valores predeterminados?',
        'Restablecer',
        'btn-warning'
    );
    if (!confirmed) return;

    const defaults = {
        maxFileSize: 10,
        maxConcurrentFiles: 5,
        maxExpedientes: 5000,
        maxActiveTasks: 2000,
        maxArchivedExpedientes: 10000
    };

    systemLimits = defaults;
    localStorage.removeItem('gescon360_systemLimits');
    
    // Recargar UI
    loadSystemLimits();
    showToast('info', 'Restablecido', 'Límites restablecidos a valores por defecto.');
}

function saveLimits() {
    console.log('Guardando límites...');
    
    const newLimits = {
        maxFileSize: parseInt(document.getElementById('maxFileSize').value) || 10,
        maxConcurrentFiles: parseInt(document.getElementById('maxConcurrentFiles').value) || 5,
        maxExpedientes: parseInt(document.getElementById('maxExpedientes').value) || 5000,
        maxActiveTasks: parseInt(document.getElementById('maxActiveTasks').value) || 2000,
        maxArchivedExpedientes: parseInt(document.getElementById('maxArchivedExpedientes').value) || 10000
    };

    systemLimits = newLimits;
    localStorage.setItem('gescon360_systemLimits', JSON.stringify(systemLimits));

    updateSystemStatusTable();
    showToast('success', 'Guardado', 'Configuración de límites actualizada correctamente.');
}

async function exportReport() {
    console.log('Generando reporte...');
    showLoading();

    try {
        // 1. Obtener datos de expedientes
        const { data: expedientes, error } = await supabaseClient
            .from('expedientes')
            .select('fecha_ocurrencia, importe, estado');

        if (error) throw error;

        if (!expedientes || expedientes.length === 0) {
            showToast('warning', 'Sin datos', 'No hay expedientes para generar el reporte.');
            return;
        }

        // 2. Procesar datos (Agrupar por mes)
        const statsByMonth = {};

        expedientes.forEach(exp => {
            // Usar fecha de ocurrencia o fecha de creación como fallback
            const dateStr = exp.fecha_ocurrencia || exp.created_at;
            if (!dateStr) return;

            const date = new Date(dateStr);
            const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`; // YYYY-MM
            
            if (!statsByMonth[monthKey]) {
                statsByMonth[monthKey] = {
                    mes: monthKey,
                    total_expedientes: 0,
                    importe_total: 0,
                    completados: 0
                };
            }

            statsByMonth[monthKey].total_expedientes++;
            statsByMonth[monthKey].importe_total += (exp.importe || 0);
            
            const estado = (exp.estado || '').toLowerCase();
            if (estado.includes('completado') || estado.includes('finalizado') || estado.includes('recobrado')) {
                statsByMonth[monthKey].completados++;
            }
        });

        // 3. Convertir a array para Excel
        const reportData = Object.values(statsByMonth)
            .sort((a, b) => b.mes.localeCompare(a.mes)) // Ordenar descendente (más reciente primero)
            .map(item => ({
                'Mes': item.mes,
                'Expedientes Procesados': item.total_expedientes,
                'Tasa de Éxito': item.total_expedientes > 0 ? ((item.completados / item.total_expedientes) * 100).toFixed(1) + '%' : '0%',
                'Importe Total': item.importe_total // Se formateará en Excel si es necesario, o se deja como número
            }));

        // 4. Generar Excel con SheetJS
        // Obtener configuración para el nombre de la empresa
        const config = JSON.parse(localStorage.getItem('gescon360_generalConfig')) || {};
        const companyName = config.companyName || 'GESCON 360';

        // Crear hoja dejando espacio para la cabecera (empezar en fila 4)
        const worksheet = XLSX.utils.json_to_sheet(reportData, { origin: 'A4' });

        // Añadir cabecera con nombre de empresa y título
        XLSX.utils.sheet_add_aoa(worksheet, [
            [companyName],
            ['Reporte Mensual de Productividad'],
            [`Generado: ${new Date().toLocaleDateString()}`]
        ], { origin: 'A1' });

        // Fusionar celdas para los títulos
        if (!worksheet['!merges']) worksheet['!merges'] = [];
        worksheet['!merges'].push(
            { s: { r: 0, c: 0 }, e: { r: 0, c: 3 } }, // Empresa
            { s: { r: 1, c: 0 }, e: { r: 1, c: 3 } }, // Título
            { s: { r: 2, c: 0 }, e: { r: 2, c: 3 } }  // Fecha
        );

        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Reporte Mensual");

        // Ajustar ancho de columnas
        const wscols = [
            {wch: 15}, // Mes
            {wch: 25}, // Expedientes
            {wch: 15}, // Tasa
            {wch: 20}  // Importe
        ];
        worksheet['!cols'] = wscols;

        // 5. Descargar archivo
        const fileName = `Reporte_Mensual_Gescon360_${new Date().toISOString().split('T')[0]}.xlsx`;
        XLSX.writeFile(workbook, fileName);
        
        showToast('success', 'Exportado', 'El reporte se ha generado correctamente.');

    } catch (error) {
        console.error('Error exportando reporte:', error);
        showToast('danger', 'Error', 'No se pudo generar el reporte: ' + error.message);
    } finally {
        hideLoading();
    }
}

async function loadArchivedExpedients(page = 1) {
    console.log(`Cargando archivados (página ${page})...`);
    const tableBody = document.getElementById('archiveTableBody');
    if (!tableBody) return;

    currentArchivePage = page;
    showLoading();
    try {
        const from = (page - 1) * ITEMS_PER_ARCHIVE_PAGE;
        const to = from + ITEMS_PER_ARCHIVE_PAGE - 1;

        // Cargar archivados con paginación
        // CORRECCIÓN: Usar tabla 'expedientes_archivados' en lugar de 'expedientes'
        // ya que server.js mueve los registros ahí.
        const { data: archives, count, error } = await supabaseClient
            .from('expedientes_archivados')
            .select('*', { count: 'exact' })
            .order('fecha_archivo', { ascending: false })
            .range(from, to);

        if (error) throw error;

        renderArchiveTable(archives);
        renderArchivePagination(count);
    } catch (error) {
        console.error('Error loading archives:', error);
        tableBody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">Error al cargar archivados: ' + error.message + '</td></tr>';
    } finally {
        hideLoading();
    }
}

function renderArchivePagination(totalItems) {
    const tableContainer = document.querySelector('#archive .custom-table');
    let paginationContainer = document.getElementById('archivePagination');
    
    if (!paginationContainer) {
        paginationContainer = document.createElement('div');
        paginationContainer.id = 'archivePagination';
        paginationContainer.className = 'd-flex justify-content-between align-items-center p-3 border-top';
        // Insertar después del contenedor de la tabla
        const tableDiv = tableContainer.querySelector('.table-container');
        if (tableDiv) {
            tableDiv.parentNode.insertBefore(paginationContainer, tableDiv.nextSibling);
        } else {
            tableContainer.appendChild(paginationContainer);
        }
    }
    
    const totalPages = Math.ceil(totalItems / ITEMS_PER_ARCHIVE_PAGE);
    const startItem = totalItems === 0 ? 0 : (currentArchivePage - 1) * ITEMS_PER_ARCHIVE_PAGE + 1;
    const endItem = Math.min(currentArchivePage * ITEMS_PER_ARCHIVE_PAGE, totalItems);
    
    paginationContainer.innerHTML = `
        <div class="text-muted small">
            Mostrando ${startItem}-${endItem} de ${totalItems} expedientes
        </div>
        <div class="btn-group">
            <button class="btn btn-sm btn-outline-secondary" 
                onclick="loadArchivedExpedients(${currentArchivePage - 1})" 
                ${currentArchivePage <= 1 ? 'disabled' : ''}>
                <i class="bi bi-chevron-left"></i> Anterior
            </button>
            <button class="btn btn-sm btn-outline-secondary" disabled>
                Página ${currentArchivePage} de ${totalPages || 1}
            </button>
            <button class="btn btn-sm btn-outline-secondary" 
                onclick="loadArchivedExpedients(${currentArchivePage + 1})" 
                ${currentArchivePage >= totalPages ? 'disabled' : ''}>
                Siguiente <i class="bi bi-chevron-right"></i>
            </button>
        </div>
    `;
}

async function searchArchive() {
    console.log('Buscando en archivo...');
    const searchInput = document.getElementById('archiveSearchInput');
    const term = searchInput ? searchInput.value.trim() : '';
    
    if (!term) {
        loadArchivedExpedients(1);
        return;
    }

    showLoading();
    try {
        let query = supabaseClient
            .from('expedientes')
            .select('*')
            .eq('estado', 'Archivado');

        if (term) {
            // Búsqueda OR en múltiples campos
            query = query.or(`num_siniestro.ilike.%${term}%,num_poliza.ilike.%${term}%,num_sgr.ilike.%${term}%,nombre_asegurado.ilike.%${term}%`);
        }

        const { data, error } = await query.order('fecha_ocurrencia', { ascending: false }).limit(50);

        if (error) throw error;
        renderArchiveTable(data);
        
        // Ocultar paginación durante búsqueda
        const paginationContainer = document.getElementById('archivePagination');
        if (paginationContainer) paginationContainer.innerHTML = '';
        
    } catch (error) {
        console.error('Error searching archive:', error);
        showToast('danger', 'Error', 'Error en la búsqueda: ' + error.message);
    } finally {
        hideLoading();
    }
}

function renderArchiveTable(data) {
    const tableBody = document.getElementById('archiveTableBody');
    if (!tableBody) return;
    tableBody.innerHTML = '';

    if (!data || data.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="7" class="text-center p-4">No se encontraron expedientes archivados.</td></tr>';
        return;
    }

    data.forEach(exp => {
        const row = document.createElement('tr');
        const importe = exp.importe ? new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(exp.importe) : '€0,00';
        // Usar created_at como fecha de archivo aproximada si no hay campo específico
        const dateStr = exp.fecha_ocurrencia || new Date().toISOString(); 
        
        row.innerHTML = `
            <td>${exp.num_siniestro || '-'}</td>
            <td>${exp.num_sgr || '-'}</td>
            <td>${exp.nombre_asegurado || '-'}</td>
            <td>${new Date(dateStr).toLocaleDateString('es-ES')}</td>
            <td>${exp.tipo_dano || '-'}</td>
            <td>${importe}</td>
            <td>
                <button class="btn btn-sm btn-outline-primary" onclick="viewExpedient('${exp.id}')" title="Ver Detalle">
                    <i class="bi bi-eye"></i>
                </button>
                <button class="btn btn-sm btn-outline-warning" onclick="restoreExpedient('${exp.id}')" title="Restaurar a Pendiente">
                    <i class="bi bi-arrow-counterclockwise"></i>
                </button>
            </td>
        `;
        tableBody.appendChild(row);
    });
}

function viewArchived(id) {
    // Reutilizamos la función viewExpedient existente que ya funciona
    viewExpedient(id);
}

async function restoreExpedient(id) {
    const confirmed = await showConfirmModal(
        'Restaurar Expediente',
        '¿Está seguro de que desea restaurar este expediente? Pasará a estado "Pendiente".',
        'Restaurar',
        'btn-warning'
    );
    if (!confirmed) return;
    
    showLoading();
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (!session) throw new Error('No hay sesión activa');

        const response = await fetch(`/api/archivados/${id}/restaurar`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${session.access_token}` }
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || 'Error al restaurar expediente');
        }

        showToast('success', 'Restaurado', 'Expediente restaurado correctamente.');
        
        // Recargar lista
        const searchInput = document.getElementById('archiveSearchInput');
        if (searchInput && searchInput.value.trim()) {
            searchArchive();
        } else {
            loadArchivedExpedients(currentArchivePage);
        }
    } catch (error) {
        console.error(error);
        showToast('danger', 'Error', error.message);
    }
    finally {
        hideLoading();
    }
}

function loadGeneralConfig() {
    console.log('Cargando configuración general...');
    const defaults = {
        companyName: 'GESCON 360',
        dateFormat: 'DD/MM/YYYY',
        autoReminders: true,
        autoArchive: true,
        autoBackup: true,
        googleCalendar: true,
        emailNotifications: true
    };

    let config = defaults;
    const saved = localStorage.getItem('gescon360_generalConfig');
    if (saved) {
        try {
            config = { ...defaults, ...JSON.parse(saved) };
        } catch (e) {
            console.error('Error parsing saved config', e);
        }
    }

    // Set values
    const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.value = val;
    };
    const setCheck = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.checked = val;
    };

    setVal('companyName', config.companyName);
    setVal('dateFormat', config.dateFormat);
    setCheck('autoReminders', config.autoReminders);
    setCheck('autoArchive', config.autoArchive);
    setCheck('autoBackup', config.autoBackup);
    setCheck('googleCalendar', config.googleCalendar);
    setCheck('emailNotifications', config.emailNotifications);
}

async function resetConfig() {
    const confirmed = await showConfirmModal(
        'Restablecer Configuración',
        '¿Restablecer la configuración general a los valores predeterminados?',
        'Restablecer',
        'btn-warning'
    );
    if (!confirmed) return;

    localStorage.removeItem('gescon360_generalConfig');
    loadGeneralConfig();
    showToast('info', 'Restablecido', 'La configuración ha sido restablecida a los valores por defecto.');
}

function saveConfig() {
    console.log('Guardando configuración...');
    
    const config = {
        companyName: document.getElementById('companyName').value,
        dateFormat: document.getElementById('dateFormat').value,
        autoReminders: document.getElementById('autoReminders').checked,
        autoArchive: document.getElementById('autoArchive').checked,
        autoBackup: document.getElementById('autoBackup').checked,
        googleCalendar: document.getElementById('googleCalendar').checked,
        emailNotifications: document.getElementById('emailNotifications').checked
    };

    localStorage.setItem('gescon360_generalConfig', JSON.stringify(config));
    showToast('success', 'Guardado', 'Configuración general guardada correctamente.');
}

async function previewImport() {
    console.log('Función previewImport llamada');
    
    const importFile = document.getElementById('importFile');
    if (!importFile || !importFile.files || importFile.files.length === 0) {
        showToast('warning', 'Sin archivo', 'Por favor selecciona un archivo para previsualizar.');
        return;
    }

    const file = importFile.files[0];
    showLoading();

    try {
        // Reutilizamos la función de parseo existente
        const data = await parsearArchivoImportacion(file, file.name);
        
        if (!data || data.length === 0) {
            showToast('warning', 'Archivo vacío', 'No se encontraron datos válidos en el archivo.');
            return;
        }

        showPreviewModal(data);

    } catch (error) {
        console.error('Error en vista previa:', error);
        showToast('danger', 'Error', 'No se pudo leer el archivo: ' + error.message);
    } finally {
        hideLoading();
    }
}

function getOrCreatePreviewModal() {
    let modalEl = document.getElementById('previewModal');
    if (!modalEl) {
        const modalHtml = `
        <div class="modal fade" id="previewModal" tabindex="-1" aria-hidden="true">
            <div class="modal-dialog modal-xl modal-dialog-centered modal-dialog-scrollable">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title"><i class="bi bi-file-earmark-spreadsheet"></i> Vista Previa de Importación</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <div class="modal-body p-0">
                        <div class="table-responsive">
                            <table class="table table-striped table-hover mb-0 table-sm" style="font-size: 0.9rem;">
                                <thead class="table-light sticky-top">
                                    <tr>
                                        <th>#</th>
                                        <th>Nº Siniestro</th>
                                        <th>Nº Póliza</th>
                                        <th>Asegurado</th>
                                        <th>Importe</th>
                                        <th>Fecha Ocurrencia</th>
                                        <th>Cía. Origen</th>
                                    </tr>
                                </thead>
                                <tbody id="previewTableBody"></tbody>
                            </table>
                        </div>
                    </div>
                    <div class="modal-footer justify-content-between">
                        <div class="text-muted small" id="previewCount"></div>
                        <div>
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cerrar</button>
                            <button type="button" class="btn btn-primary" id="btnConfirmImport">
                                <i class="bi bi-upload"></i> Importar Ahora
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        modalEl = document.getElementById('previewModal');
    }
    return modalEl;
}

function showPreviewModal(data) {
    const modalEl = getOrCreatePreviewModal();
    const tbody = document.getElementById('previewTableBody');
    const countSpan = document.getElementById('previewCount');
    const btnConfirm = document.getElementById('btnConfirmImport');
    
    tbody.innerHTML = '';
    countSpan.textContent = `Mostrando primeros 50 de ${data.length} registros detectados.`;

    // Limitar vista previa a 50 registros para rendimiento
    const previewData = data.slice(0, 50);

    previewData.forEach((row, index) => {
        const tr = document.createElement('tr');
        const importe = row.importe ? new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(row.importe) : '-';
        
        tr.innerHTML = `
            <td>${index + 1}</td>
            <td>${row.num_siniestro || '<span class="text-danger">Falta</span>'}</td>
            <td>${row.num_poliza || '-'}</td>
            <td>${row.nombre_asegurado || '-'}</td>
            <td>${importe}</td>
            <td>${row.fecha_ocurrencia || '-'}</td>
            <td>${row.cia_origen || '-'}</td>
        `;
        tbody.appendChild(tr);
    });

    if (data.length > 50) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td colspan="7" class="text-center text-muted fst-italic">... y ${data.length - 50} registros más ...</td>`;
        tbody.appendChild(tr);
    }

    // Configurar botón de confirmar
    // Clonar para eliminar listeners previos
    const newBtn = btnConfirm.cloneNode(true);
    btnConfirm.parentNode.replaceChild(newBtn, btnConfirm);
    
    newBtn.onclick = () => {
        const modal = bootstrap.Modal.getInstance(modalEl);
        modal.hide();
        importarExpedientes(); // Llamar a la función principal
    };

    const modal = new bootstrap.Modal(modalEl);
    modal.show();
}

async function importarExpedientes() {
    console.log('Función importarExpedientes llamada');
    
    // Obtener archivo
    const importFile = document.getElementById('importFile');
    if (!importFile || !importFile.files || importFile.files.length === 0) {
        showToast('warning', 'Sin archivo', 'Por favor selecciona un archivo CSV o Excel para importar.');
        return;
    }

    const file = importFile.files[0];
    
    // Validar tamaño (10 MB máximo)
    const maxSize = 10 * 1024 * 1024; // 10 MB
    if (file.size > maxSize) {
        showToast('danger', 'Archivo muy grande', 'El archivo excede el tamaño máximo de 10 MB.');
        return;
    }

    showLoading();
    
    try {
        // PASO 1: Parsear archivo con SheetJS
        showToast('info', 'Parseando', 'Leyendo archivo...');
        
        // Helper para leer Base64
        const getBase64 = (file) => new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = () => resolve(reader.result.split(',')[1]);
            reader.onerror = error => reject(error);
        });

        // Ejecutar en paralelo: Parsing y Lectura Base64
        const [data, fileBase64] = await Promise.all([
            parsearArchivoImportacion(file, file.name),
            getBase64(file)
        ]);
        
        if (!data || data.length === 0) {
            showToast('warning', 'Archivo vacío', 'El archivo no contiene datos válidos.');
            hideLoading();
            return;
        }

        // Obtener opciones de importación
        const verificarDuplicados = document.getElementById('validateDuplicates')?.checked ?? true;
        const normalizarCampos = document.getElementById('normalizeFields')?.checked ?? true;
        const distribuirTareas = document.getElementById('autoTransfer')?.checked ?? true;
        const distribuirEquitativamente = document.getElementById('autoDistributeImport')?.checked ?? true;
        
        showToast('info', 'Procesando', `Se encontraron ${data.length} expedientes. Procesando...`);
        
        // PASO 2: Verificar duplicados si está activado
        let expedientesParaInsertar = data;
        let duplicadosEncontrados = [];
        
        if (verificarDuplicados) {
            showToast('info', 'Verificando', 'Verificando duplicados por nº siniestro...');
            const resultado = await verificarYEliminarDuplicados(data);
            expedientesParaInsertar = resultado.nuevos;
            duplicadosEncontrados = resultado.duplicados;
            
            if (duplicadosEncontrados.length > 0) {
                showToast('warning', 'Duplicados encontrados', 
                    `Se encontraron ${duplicadosEncontrados.length} duplicados que no serán importados.`);
                
                // Guardar en tabla duplicados para revisión manual
                try {
                    const duplicadosParaInsertar = duplicadosEncontrados.map(d => ({
                        ...d,
                        fecha_deteccion: new Date().toISOString(),
                        veces_repetido: 1
                    }));
                    await supabaseClient.from('duplicados').insert(duplicadosParaInsertar);
                } catch (e) {
                    console.error('Error guardando duplicados en DB:', e);
                }
            }
        }
        
        // PASO 3: Insertar en Supabase
        if (expedientesParaInsertar.length === 0) {
            hideLoading();
            showToast('warning', 'Sin nuevos expedientes', 'Todos los expedientes ya existían en el sistema.');
            return;
        }
        
        // Empaquetar opciones
        const opcionesImportacion = { distribuirTareas, distribuirEquitativamente };
        
        // Enviar a backend incluyendo el archivo Base64
        const resultado = await insertarExpedientesEnSupabase(expedientesParaInsertar, file.name, opcionesImportacion, fileBase64);

        // Verificar referencia generada (si la DB tiene trigger/columna generada)
        if (resultado.expedientes && resultado.expedientes.length > 0) {
            console.log('Referencia Gescon generada (ejemplo):', resultado.expedientes[0].referencia_gescon);
        }

        // REGISTRAR IMPORTACIÓN (LOG)
        // El log ahora se guarda en el backend al llamar a insertarExpedientesEnSupabase
        // Si hubo duplicados detectados en el cliente, podríamos querer actualizar ese log, 
        // pero por simplicidad dejamos que el backend registre lo que procesó.
        // Opcional: Si quieres registrar los duplicados detectados en cliente, 
        // podrías hacer una llamada extra o incluirlos en la llamada al backend.
        // Por ahora, confiamos en el log del backend para los insertados.

        hideLoading();
        showToast('success', 'Importación Completada', 
            `Se importaron ${resultado.insertados} expedientes correctamente.`);
        
        // Recargar dashboard stats
        await loadDashboardStats();
        loadImportLogs(); // Refrescar tabla de logs

    } catch (error) {
        console.error('Error importando expedientes:', error);
        hideLoading();
        showToast('danger', 'Error', 'Error al importar expedientes: ' + error.message);
    }
}

// ============================================================================
// GESTIÓN DE REGISTRO DE IMPORTACIONES (LOGS)
// ============================================================================

async function loadImportLogs() {
    const tableBody = document.getElementById('importLogTable');
    if (!tableBody) return;

    const dateInput = document.getElementById('importLogDateFilter');
    const dateValue = dateInput ? dateInput.value : null;

    try {
        let query = supabaseClient
            .from('import_logs')
            .select('id, created_at, file_name, total_records, status, duplicates_count, distribution_details')
            .order('created_at', { ascending: false });

        if (dateValue) {
            const start = new Date(dateValue + 'T00:00:00');
            const end = new Date(dateValue + 'T23:59:59.999');
            query = query
                .gte('created_at', start.toISOString())
                .lte('created_at', end.toISOString());
        } else {
            query = query.limit(20);
        }

        const { data: logs, error } = await query;

        if (error) throw error;

        tableBody.innerHTML = '';
        if (!logs || logs.length === 0) {
            const msg = dateValue ? 'No hay registros para la fecha seleccionada.' : 'No hay registros de importación recientes.';
            tableBody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">${msg}</td></tr>`;
            return;
        }

        logs.forEach(log => {
            const row = document.createElement('tr');
            const date = new Date(log.created_at).toLocaleString();
            
            // Determinar si hay incidencias para habilitar el botón de detalles
            const hasIssues = (log.duplicates_count > 0) || (log.status === 'Error') || (log.distribution_details);
            
            row.innerHTML = `
                <td>${date}</td>
                <td>${log.file_name || '-'}</td>
                <td>${log.total_records || 0}</td>
                <td><span class="status-badge status-${log.status === 'Completado' ? 'completado' : 'pendiente'}">${log.status}</span></td>
                <td>${log.duplicates_count || 0}</td>
                <td>
                    <div class="btn-group btn-group-sm">
                        <button class="btn btn-outline-secondary" onclick="downloadImportFile('${log.id}', '${log.file_name}')" title="Descargar Archivo Original">
                            <i class="bi bi-download"></i>
                        </button>
                        <button class="btn btn-outline-danger" onclick="viewImportErrors('${log.id}')" title="Ver Detalles/Errores" ${hasIssues ? '' : 'disabled'}>
                            <i class="bi bi-exclamation-circle"></i>
                        </button>
                    </div>
                </td>
            `;
            tableBody.appendChild(row);
        });
    } catch (error) {
        if (error.code === 'PGRST205') {
            // Tabla no existe: Mostrar mensaje informativo en lugar de error
            tableBody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">Historial no disponible (Tabla import_logs no configurada).</td></tr>';
        } else {
            console.warn('Error loading import logs:', error);
        }
    }
}

async function exportImportLogsToExcel() {
    console.log('Exporting import logs...');
    showLoading();

    try {
        const { data: logs, error } = await supabaseClient
            .from('import_logs')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(1000);

        if (error) throw error;

        if (!logs || logs.length === 0) {
            showToast('warning', 'Sin datos', 'No hay registros de importación para exportar.');
            return;
        }

        const exportData = logs.map(log => ({
            'Fecha': new Date(log.created_at).toLocaleString(),
            'Archivo': log.file_name || '-',
            'Total Registros': log.total_records || 0,
            'Estado': log.status || '-',
            'Duplicados': log.duplicates_count || 0
        }));

        // Obtener configuración para el nombre de la empresa
        const config = JSON.parse(localStorage.getItem('gescon360_generalConfig')) || {};
        const companyName = config.companyName || 'GESCON 360';

        const worksheet = XLSX.utils.json_to_sheet(exportData, { origin: 'A4' });
        XLSX.utils.sheet_add_aoa(worksheet, [
            [companyName],
            ['Historial de Importaciones'],
            [`Generado: ${new Date().toLocaleDateString()}`]
        ], { origin: 'A1' });

        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Historial Importaciones");

        const wscols = [
            {wch: 22},
            {wch: 30},
            {wch: 15},
            {wch: 15},
            {wch: 12}
        ];
        worksheet['!cols'] = wscols;

        const fileName = `Historial_Importaciones_${new Date().toISOString().split('T')[0]}.xlsx`;
        XLSX.writeFile(workbook, fileName);

        showToast('success', 'Exportado', 'Historial exportado correctamente.');
    } catch (error) {
        console.error('Error exporting logs:', error);
        showToast('danger', 'Error', 'Error al exportar: ' + error.message);
    } finally {
        hideLoading();
    }
}

function downloadImportFile(id, fileName) {
    // Nota: Para que esto funcione realmente, se debe implementar la subida del archivo a Supabase Storage al importar
    console.log(`Solicitando descarga de archivo: ${fileName} (Log ID: ${id})`);
    showToast('info', 'Descarga no disponible', 'El archivo original no está almacenado. Se requiere configurar Supabase Storage.');
}

async function viewImportErrors(id) {
    showLoading();
    try {
        // Obtener detalles específicos del log (incluyendo JSON de errores)
        const { data: log, error } = await supabaseClient
            .from('import_logs')
            .select('error_details, distribution_details, status, file_name')
            .eq('id', id)
            .single();

        if (error) throw error;

        const hasErrors = log.error_details && log.error_details.length > 0;
        const hasDistribution = log.distribution_details && Object.keys(log.distribution_details).length > 0;

        if (!hasErrors && !hasDistribution) {
            showToast('info', 'Sin detalles', 'Este registro no contiene detalles adicionales.');
            return;
        }

        const modalEl = getOrCreateDetailsModal();
        const modalTitle = document.getElementById('detailsModalTitle');
        const modalBody = document.getElementById('detailsModalBody');

        modalTitle.textContent = `Detalles de Importación: ${log.file_name}`;
        
        let html = `<div class="alert alert-${log.status === 'Completado' ? 'success' : 'warning'} mb-3">
                        Estado: <strong>${log.status}</strong>
                    </div>`;
        
        if (hasDistribution) {
            html += `<h6 class="mb-2">Distribución de Tareas:</h6>
                     <ul class="list-group mb-4">`;
            for (const [user, count] of Object.entries(log.distribution_details)) {
                html += `<li class="list-group-item d-flex justify-content-between align-items-center">
                            ${user}
                            <span class="badge bg-primary rounded-pill">${count}</span>
                         </li>`;
            }
            html += `</ul>`;
        }

        if (hasErrors) {
            html += `<h6 class="mb-2">Errores Detectados (${log.error_details.length}):</h6>
                    <div class="table-responsive" style="max-height: 400px; overflow-y: auto;">
                        <table class="table table-sm table-bordered table-striped">
                            <thead class="table-light sticky-top">
                                <tr>
                                    <th style="width: 50px;">#</th>
                                    <th>Error</th>
                                    <th>Datos del Registro</th>
                                </tr>
                            </thead>
                            <tbody>`;
            
            log.error_details.forEach((err, index) => {
                const expData = err.expediente ? JSON.stringify(err.expediente) : 'N/A';
                const shortExpData = expData.length > 120 ? expData.substring(0, 120) + '...' : expData;
                
                html += `<tr>
                            <td>${index + 1}</td>
                            <td class="text-danger small">${err.error || 'Error desconocido'}</td>
                            <td><small class="text-muted font-monospace" title="${expData.replace(/"/g, '&quot;')}">${shortExpData}</small></td>
                         </tr>`;
            });
            html += `</tbody></table></div>`;
        }
        
        modalBody.innerHTML = html;
        
        const modal = new bootstrap.Modal(modalEl);
        modal.show();

    } catch (e) {
        console.error('Error fetching log details:', e);
        showToast('danger', 'Error', 'No se pudieron cargar los detalles: ' + e.message);
    } finally {
        hideLoading();
    }
}

        // ============================================================================
// FUNCIONES AUXILIARES PARA IMPORTACIÓN DE EXPEDIENTES - FASE 2a
// ============================================================================


        // Función para verificar y eliminar duplicados por nº de siniestro
async function verificarYEliminarDuplicados(expedientes) {
    try {
        // Obtener todos los números de siniestro del archivo
        const numerosSiniestro = expedientes.map(exp => exp.num_siniestro).filter(n => n);
        const numerosPoliza = expedientes.map(exp => exp.num_poliza).filter(n => n);
        
        if (numerosSiniestro.length === 0 && numerosPoliza.length === 0) {
            return { nuevos: expedientes, duplicados: [] };
        }
        
        // Consultar en Supabase qué números de siniestro ya existen
        const { data: existentes, error } = await supabaseClient
            .from('expedientes')
            .select('num_siniestro, estado, num_poliza')
            .in('num_siniestro', numerosSiniestro);
        
        if (error) throw error;

        // Consultar pólizas existentes (si hay coincidencias)
        let existentesPolizas = [];
        if (numerosPoliza.length > 0) {
            const { data: pols } = await supabaseClient
                .from('expedientes')
                .select('num_poliza, num_siniestro, estado')
                .in('num_poliza', numerosPoliza);
            existentesPolizas = pols || [];
        }
        
        // Consultar si existen TAREAS activas para estos siniestros
        // Esto evita marcar como duplicado un expediente que existe pero no tiene tarea (huérfano)
        // FIX: Usar num_siniestro como clave de enlace (evita problemas con IDs internos)
        const todosSiniestrosExistentes = [
            ...existentes.map(e => e.num_siniestro),
            ...existentesPolizas.map(e => e.num_siniestro)
        ].filter(n => n);

        let tareasActivasSet = new Set();
        if (todosSiniestrosExistentes.length > 0) {
            const { data: tareas } = await supabaseClient
                .from('seguimientos')
                .select('num_siniestro') // FIX: Join lógico por num_siniestro
                .in('num_siniestro', todosSiniestrosExistentes);
            
            if (tareas) {
                tareas.forEach(t => tareasActivasSet.add(t.num_siniestro));
            }
        }

        // Mapas para búsqueda rápida de expedientes existentes
        const mapSiniestros = new Map(existentes.map(e => [e.num_siniestro, e]));
        const mapPolizas = new Map(existentesPolizas.map(e => [e.num_poliza, e]));
        
        // Separar expedientes nuevos de duplicados
        const nuevos = [];
        const duplicados = [];
        
        expedientes.forEach(exp => {
            // Buscar coincidencia en DB
            let match = null;
            if (exp.num_siniestro && mapSiniestros.has(exp.num_siniestro)) {
                match = mapSiniestros.get(exp.num_siniestro);
            } else if (exp.num_poliza && mapPolizas.has(exp.num_poliza)) {
                match = mapPolizas.get(exp.num_poliza);
            }

            // Lógica de Duplicado:
            // Es duplicado SI existe en expedientes Y (está Archivado O tiene Tarea activa)
            // Si existe en expedientes pero NO está archivado NI tiene tarea, es un "falso positivo" (carga fallida previa) -> Procesar como Nuevo (Update)
            
            let esDuplicadoReal = false;
            
            if (match) {
                const estaArchivado = match.estado === 'Archivado';
                const tieneTarea = tareasActivasSet.has(match.num_siniestro);
                
                if (estaArchivado || tieneTarea) {
                    esDuplicadoReal = true;
                }
                // Si no está archivado y no tiene tarea, asumimos que es un reintento de carga -> No es duplicado
            }

            if (esDuplicadoReal) {
                duplicados.push(exp);
            } else {
                nuevos.push(exp);
            }
        });

        // Enviar notificación al admin si hay duplicados
        if (duplicados.length > 0) {
            const adminEmail = 'jesus.mp@gescon360.es';
            const subject = `⚠️ Detectados ${duplicados.length} duplicados en importación`;
            const html = `<p>Se han detectado <strong>${duplicados.length}</strong> expedientes que coinciden con registros existentes (por Nº Siniestro o Póliza).</p>
                          <p>Se han movido a la bandeja de Duplicados para su revisión manual.</p>`;
            
                      
            // No esperamos la respuesta para no bloquear la UI
            supabaseClient.auth.getSession().then(({ data: { session } }) => {
                if (session) {
                    fetch('/api/send-email', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${session.access_token}`
                        },
                        body: JSON.stringify({ to: adminEmail, subject, html })
                    }).catch(err => console.error('Error enviando aviso duplicados:', err));
                }
            });
        }
        
        return { nuevos, duplicados };
    } catch (error) {
        console.error('Error verificando duplicados:', error);
        // En caso de error, devolvemos los originales para no bloquear la importación
        return { nuevos: expedientes, duplicados: [] };
    }
}

// Función auxiliar para parsear archivo CSV/Excel con SheetJS
async function parsearArchivoImportacion(file, fileName) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = function(e) {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array', cellDates: true });
                
                // Obtener la primera hoja
                const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                
                // Convertir a JSON
                const jsonData = XLSX.utils.sheet_to_json(firstSheet, { defval: '' });
                
                // Normalizar y mapear campos
                const expedientesNormalizados = jsonData
                    .map((row, index) => normalizarExpediente(row, fileName, index))
                    .filter(item => item !== null); // Filtrar registros inválidos
                
                resolve(expedientesNormalizados);
            } catch (error) {
                reject(new Error('Error al parsear el archivo: ' + error.message));
            }
        };

        reader.onerror = function() {
            reject(new Error('Error al leer el archivo'));
        };

        reader.readAsArrayBuffer(file);
    });
}

// Función para normalizar un expediente
function normalizarExpediente(row, fileName, index) {
    // Helper para limpiar cadenas
    const cleanString = (val) => {
        if (val === null || val === undefined) return '';
        return String(val).trim();
    };

    // Helper para parsear importes (soporta formatos 1.234,56 y 1,234.56)
    const parseAmount = (val) => {
        if (typeof val === 'number') return val;
        if (!val) return 0;
        
        let str = String(val).replace(/[€$£\s]/g, '');
        
        // Si tiene coma y punto, determinar cuál es el separador decimal
        if (str.indexOf(',') > -1 && str.indexOf('.') > -1) {
            if (str.lastIndexOf(',') > str.lastIndexOf('.')) {
                // Formato europeo: 1.234,56 -> 1234.56
                str = str.replace(/\./g, '').replace(',', '.');
            } else {
                // Formato americano: 1,234.56 -> 1234.56
                str = str.replace(/,/g, '');
            }
        } else if (str.indexOf(',') > -1) {
            // Solo comas: asumir decimal si es formato español común
            str = str.replace(',', '.');
        }
        
        const num = parseFloat(str);
        return isNaN(num) ? 0 : num;
    };

    // Helper para formatear fechas
    const formatDate = (val) => {
        if (!val) return null;
        
        // Si ya es objeto Date (gracias a cellDates: true de SheetJS)
        if (val instanceof Date) {
            return isNaN(val.getTime()) ? null : val.toISOString().split('T')[0];
        }

        // Manejar fechas numéricas de Excel (Serial Date)
        if (typeof val === 'number') {
            const date = new Date(Math.round((val - 25569) * 86400 * 1000));
            return isNaN(date.getTime()) ? null : date.toISOString().split('T')[0];
        }
        
        // Intentar parsear string
        const strVal = String(val).trim();
        
        // Formato DD/MM/YYYY
        if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}$/.test(strVal)) {
            const parts = strVal.split(/[\/\-]/);
            // Asumir DD/MM/YYYY
            const d = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
            if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
        }
        
        // Intento genérico
        const d = new Date(strVal);
        return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
    };

    // Extracción de campos clave
    const numSiniestro = cleanString(row['Nº Siniestro'] || row['num_siniestro'] || row['NUM_SINIESTRO']);
    
    // Validación crítica: Sin número de siniestro no es un expediente válido
    if (!numSiniestro) {
        console.warn('Registro ignorado por falta de Nº Siniestro:', row);
        return null;
    }

    // REQ: Referencia Gescon = NombreFichero + Número
    // const referenciaGescon = `${fileName}_${index + 1}`;

    // Extraer compañía del nombre del archivo (ej: Mapfre-02-12.xlsx -> Mapfre)
    const companyName = fileName ? fileName.split('-')[0].trim() : '';

    return {
        num_siniestro: numSiniestro,
        // referencia_gescon: referenciaGescon, // Columna no existe en DB
        cia_origen: companyName,
        num_poliza: cleanString(row['Nº Póliza'] || row['num_poliza'] || row['NUM_POLIZA']),
        num_sgr: cleanString(row['Nº SGR'] || row['num_sgr'] || row['NUM_SGR']), // REQ: Puede venir vacío para rellenar manual
        nombre_asegurado: cleanString(row['Asegurado'] || row['nombre_asegurado'] || row['NOMBRE']),
        direccion_asegurado: cleanString(row['Dirección'] || row['direccion'] || row['DIRECCION']),
        cp: cleanString(row['CP'] || row['codigo_postal']),
        importe: parseAmount(row['Importe'] || row['importe']),
        fecha_ocurrencia: formatDate(row['Fecha Ocurrencia'] || row['fecha_ocurrencia']),
        tipo_dano: cleanString(row['Tipo Daño'] || row['tipo_dano'] || row['TIPO_DAÑO']),
        nombre_causante: cleanString(row['Causante'] || row['nombre_causante']),
        direccion_causante: cleanString(row['Dirección Causante'] || row['direccion_causante']),
        cia_causante: cleanString(row['Cía Causante'] || row['cia_causante']),
        estado: 'Pdte. revisión', // Estado inicial por defecto para el expediente también
        fecha_inicio: new Date().toISOString().split('T')[0]
    };
}

// Función para insertar expedientes en Supabase
async function insertarExpedientesEnSupabase(expedientes, fileName, opciones = {}, fileBase64 = null) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 300000); // 5 minutos timeout para archivos grandes

    try {
        const session = await supabaseClient.auth.getSession();
        if (!session?.data?.session?.access_token) throw new Error('No hay sesión activa');

        const payload = { expedientes, fileName, opciones };
        if (fileBase64) payload.fileBase64 = fileBase64;

        const response = await fetch('/api/expedientes/importar', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session.data.session.access_token}`
            },
            body: JSON.stringify(payload),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.error || `Error del servidor (${response.status})`);
        }

        const resultados = await response.json();

        return {
            insertados: resultados.exitosos.length,
            expedientes: resultados.exitosos,
            tareasCreadas: resultados.tareasCreadas || 0
        };
    } catch (error) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
            throw new Error('Tiempo de espera agotado. El archivo tarda demasiado en subir, verifica tu conexión.');
        }
        if (error.message === 'Failed to fetch') {
            throw new Error('Error de conexión. No se pudo contactar con el servidor.');
        }
        throw new Error('Error al importar expedientes: ' + error.message);
    }
}

// ============================================================================
// SUPABASE REALTIME - NOTIFICACIONES
// ============================================================================

function setupRealtimeSubscription() {
    if (!currentUser || realtimeSubscription) return;

    console.log('Configurando suscripción Realtime para:', currentUser.name);

    realtimeSubscription = supabaseClient
        .channel('public:seguimientos')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'seguimientos' }, payload => {
            handleRealtimeEvent(payload);
        })
        .subscribe((status) => {
            console.log('Estado suscripción Realtime:', status);
        });
}

function handleRealtimeEvent(payload) {
    if (!currentUser) return;
    
    const { eventType, new: newRecord, old: oldRecord } = payload;
    
    // Verificar si la tarea me afecta (coincidencia por nombre o email)
    const myName = currentUser.name;
    const myEmail = currentUser.email;
    
    const isAssignedToMe = (record) => record && (record.responsable === myName || record.responsable === myEmail);
    
    if (eventType === 'INSERT') {
        if (isAssignedToMe(newRecord)) {
            showToast('info', '🔔 Nueva Tarea', `Se te ha asignado: ${newRecord.descripcion || 'Sin descripción'}`);
            refreshViews();
        }
    } else if (eventType === 'UPDATE') {
        const assignedNow = isAssignedToMe(newRecord);
        const assignedBefore = isAssignedToMe(oldRecord);
        
        if (assignedNow && !assignedBefore) {
            showToast('info', '🔔 Tarea Reasignada', `Se te ha transferido: ${newRecord.descripcion || 'Sin descripción'}`);
            refreshViews();
        } else if (assignedNow) {
            // Actualización en mi tarea (ej. cambio de estado por otro usuario)
            refreshViews();
        }
    }
}

function refreshViews() {
    loadDashboardStats();
    if (document.getElementById('tasks').classList.contains('active')) loadTasks();
    if (document.getElementById('workload').classList.contains('active')) loadWorkloadStats();
}

// Initialize function to load app after login
async function initializeApp() {
    console.log('Initializing app...');
    try {
        // Iniciar escucha de eventos en tiempo real
        setupRealtimeSubscription();
    } catch (error) {
        console.error('Error initializing app:', error);
    }
}
        
    // ============================================================================
// DASHBOARD & STATISTICS FUNCTIONS
// ============================================================================

// Load dashboard statistics from Supabase
async function loadDashboardStats() {
    console.log('Loading dashboard statistics...');
    
    try {
        const session = await supabaseClient.auth.getSession();
        if (!session?.data?.session?.access_token) return;

        const response = await fetch('/api/dashboard/stats', {
            headers: { 'Authorization': `Bearer ${session.data.session.access_token}` }
        });

        if (!response.ok) throw new Error('Error fetching stats');
        
        const result = await response.json();
        const stats = result.data || result || {};
        
        // Update dashboard cards using IDs
        const updateStat = (id, value) => {
            const el = document.getElementById(id);
            if (el) el.textContent = (value !== undefined && value !== null) ? value : 0;
        };

        updateStat('totalExpedients', stats.total);
        updateStat('pendingExpedients', stats.pendientes);
        updateStat('processExpedients', stats.enProceso);
        updateStat('dueTodayExpedients', stats.vencimientoHoy);
        
        console.log('Dashboard stats loaded:', stats);
    } catch (error) {
        console.error('Error loading dashboard stats:', error);
        showToast('danger', 'Error', 'No se pudieron cargar las estadísticas del dashboard');
    }
}

// Update user display info
function updateUserDisplay() {
    if (currentUser) {
        const userNameElement = document.getElementById('userName');
        if (userNameElement) {
            userNameElement.textContent = 'Usuario: ' + (currentUser.name || currentUser.email);
        }
    }
}

async function loadReports() {
    console.log('Cargando reportes...');
    showLoading();
    try {
        const session = await supabaseClient.auth.getSession();
        if (!session?.data?.session?.access_token) throw new Error('No hay sesión activa');

        const response = await fetch('/api/reports/charts', {
            headers: { 'Authorization': `Bearer ${session.data.session.access_token}` }
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || 'Error al cargar datos de reportes');
        }
        const result = await response.json();
        const chartData = result.data || result;

        if (chartData) {
            renderMonthlyChart(chartData.monthly);
            renderStatusChart(chartData.status);
        }
    } catch (error) {
        console.error('Error loading reports:', error);
        showToast('danger', 'Error', 'No se pudieron cargar los gráficos: ' + error.message);
    } finally {
        hideLoading();
    }
}

// ============================================================================
// AUTOMATIZACIÓN DIARIA (TRIGGERS INTERNOS)
// ============================================================================

async function runDailyAutomations() {
    const today = new Date().toISOString().split('T')[0];
    const lastRun = localStorage.getItem('gescon360_lastDailyRun');

    if (lastRun !== today) {
        console.log('Ejecutando automatizaciones diarias...');
        
        try {
            // 1. Archivar Finalizados (Limpieza previa)
            await archivarFinalizados();
            
            // 2. Reactivar usuarios que han vuelto (Antes de distribuir)
            const { data: { session } } = await supabaseClient.auth.getSession();
            if (session) {
                const response = await fetch('/admin/users/reactivate', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${session.access_token}` }
                });
                if (response.ok) {
                    const resData = await response.json();
                    if (resData.reactivated > 0) showToast('success', 'Reactivación', `${resData.reactivated} usuarios reactivados.`);
                }
            }

            // 3. Redistribuir carga de usuarios ausentes (Para que el email llegue al nuevo responsable)
            if (session) {
                const responseRedist = await fetch('/admin/redistribute-tasks', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${session.access_token}` }
                });
                if (responseRedist.ok) {
                    const resData = await responseRedist.json();
                    console.log('Redistribución automática:', resData);
                    if (resData.redistributed > 0) {
                        showToast('info', 'Automatización', `${resData.redistributed} tareas redistribuidas.`);
                    }
                }
            }

            // 4. Enviar Resumen de Tareas (Ahora que todo está actualizado)
            await enviarResumenTareasPorGestor();
            
            // Marcar como ejecutado hoy
            localStorage.setItem('gescon360_lastDailyRun', today);
            showToast('info', 'Automatización', 'Tareas diarias ejecutadas correctamente.');
            
        } catch (error) {
            console.error('Error en automatización diaria:', error);
        }
    } else {
        console.log('Automatizaciones diarias ya ejecutadas hoy.');
    }
}

async function enviarResumenTareasPorGestor() {
    console.log('Iniciando envío de resumen de tareas...');
    
    try {
        // 1. Obtener tareas pendientes
        const { data: tasks, error } = await supabaseClient
            .from('seguimientos')
            .select('*')
            .neq('estado', 'Completada')
            .neq('estado', 'Recobrado')
            .neq('estado', 'Archivado')
            .order('fecha_limite', { ascending: true });
            
        if (error) throw error;
        
        if (!tasks || tasks.length === 0) {
            console.log('No hay tareas pendientes para notificar.');
            return;
        }

        // 2. Agrupar por responsable
        const tasksByResponsible = {};
        tasks.forEach(task => {
            const resp = task.responsable;
            if (!resp) return;
            if (!tasksByResponsible[resp]) tasksByResponsible[resp] = [];
            tasksByResponsible[resp].push(task);
        });

        // 3. Obtener mapa de emails de usuarios activos para asegurar envío correcto
        const { data: { session } } = await supabaseClient.auth.getSession();
        const userEmailMap = new Map();
        
        if (session) {
            try {
                const response = await fetch('/api/responsables', {
                    headers: { 'Authorization': `Bearer ${session.access_token}` }
                });
                if (response.ok) {
                    const result = await response.json();
                    const users = Array.isArray(result) ? result : (result.data || []);
                    users.forEach(u => {
                        if (u.full_name) userEmailMap.set(u.full_name, u.email);
                        userEmailMap.set(u.email, u.email);
                    });
                }
            } catch (e) { console.warn('Error cargando mapa de emails:', e); }
        }

        // 3. Enviar correos (Iterar responsables)
        let emailsSent = 0;
        
        for (const [responsable, userTasks] of Object.entries(tasksByResponsible)) {
            // Resolver email usando el mapa actualizado del servidor
            let email = userEmailMap.get(responsable);
            
            // Fallback: Si no está en el mapa, intentar usar el string si parece email
            if (!email && responsable.includes('@')) {
                email = responsable;
            }

            if (email && email.includes('@')) {
                // Limitar a 150 tareas (req usuario)
                const tasksToSend = userTasks.slice(0, 150);
                
                // Generar HTML del correo
                const listItems = tasksToSend.map(t => {
                    const fecha = t.fecha_limite ? new Date(t.fecha_limite).toLocaleDateString() : 'Sin fecha';
                    return `<li><strong>${t.num_siniestro || 'S/N'}</strong>: ${t.descripcion} <span style="color:#d9534f;">(Vence: ${fecha})</span></li>`;
                }).join('');

                const htmlBody = `
                    <div style="font-family: Arial, sans-serif; color: #333;">
                        <h2 style="color: #2c3e50;">Resumen Diario de Tareas - Gescon360</h2>
                        <p>Hola ${responsable},</p>
                        <p>Tienes <strong>${userTasks.length}</strong> tareas pendientes. Aquí tienes las más urgentes:</p>
                        <ul>${listItems}</ul>
                        <p>Por favor, accede a la plataforma para gestionarlas.</p>
                        <hr>
                        <small style="color: #7f8c8d;">Este es un mensaje automático del sistema Gescon360.</small>
                    </div>
                `;

                // Llamar a Backend API en lugar de Edge Function (evita FunctionsFetchError)
                try {
                    const { data: { session } } = await supabaseClient.auth.getSession();
                    const response = await fetch('/api/send-email', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${session?.access_token}`
                        },
                        body: JSON.stringify({ 
                            to: email, 
                            subject: `📝 Tus Tareas Pendientes - ${new Date().toLocaleDateString()}`, 
                            html: htmlBody 
                        })
                    });

                    if (response.ok) emailsSent++;
                    else console.warn(`Error enviando a ${email}:`, await response.text());
                } catch (e) {
                    console.error(`Excepción enviando a ${email}:`, e);
                }
            }
        }

        if (emailsSent > 0) showToast('success', 'Notificaciones enviadas', `Se enviaron ${emailsSent} correos de resumen.`);

    } catch (error) {
        console.error('Error en proceso de envío de correos:', error);
        showToast('danger', 'Error', 'Fallo al enviar resúmenes: ' + error.message);
    }
}

async function archivarFinalizados() {
    console.log('Archivando tareas finalizadas...');
    
    try {
        // Buscar tareas finalizadas o finalizadas parciales
        const { data: finishedTasks, error } = await supabaseClient
            .from('seguimientos')
            .select('*')
            .or('estado.eq.Completada,estado.eq.Finalizado,estado.eq.Finalizado Parcial');
            
        if (error) {
            console.error('Error buscando tareas para archivar:', error);
            return;
        }

        if (finishedTasks && finishedTasks.length > 0) {
            // En este sistema, "Archivar" podría significar mover a una tabla histórica o cambiar estado a 'Archivado'
            // Vamos a cambiar el estado a 'Archivado' para que desaparezcan de la vista principal
            const ids = finishedTasks.map(t => t.id);
            
            const { error: updateError } = await supabaseClient
                .from('seguimientos')
                .update({ estado: 'Archivado' })
                .in('id', ids);
                
            if (!updateError) {
                console.log(`${ids.length} tareas movidas a archivo.`);
            }
        }
    } catch (e) {
        console.error('Error en archivarFinalizados:', e);
    }
}

function renderMonthlyChart(stats) {
    const canvas = document.getElementById('monthlyChart');
    if (!canvas || !stats) return;
    const ctx = canvas.getContext('2d');

    // Ordenar cronológicamente
    const labels = Object.keys(stats).sort();
    const data = labels.map(k => stats[k]);

    // Destruir gráfico anterior si existe para evitar superposiciones
    if (monthlyChartInstance) {
        monthlyChartInstance.destroy();
    }

    // Crear gráfico de línea
    monthlyChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Expedientes por Mes',
                data: data,
                borderColor: '#3498db',
                backgroundColor: 'rgba(52, 152, 219, 0.1)',
                borderWidth: 2,
                fill: true,
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { position: 'top' } },
            scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } }
        }
    });
}

function renderStatusChart(stats) {
    const canvas = document.getElementById('statusChart');
    if (!canvas || !stats) return;
    const ctx = canvas.getContext('2d');

    if (statusChartInstance) statusChartInstance.destroy();

    statusChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: Object.keys(stats),
            datasets: [{
                data: Object.values(stats),
                backgroundColor: ['#f1c40f', '#3498db', '#2ecc71', '#e74c3c', '#9b59b6', '#95a5a6'],
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { position: 'right' } }
        }
    });
}

// ============================================================================
// UTILIDADES DE MANTENIMIENTO Y LIMPIEZA
// ============================================================================

/**
 * Detecta y elimina expedientes que no tienen una tarea asociada.
 * Útil para limpiar tras importaciones fallidas.
 */
async function limpiarExpedientesHuerfanos() {
    console.log('🔍 Buscando expedientes huérfanos (sin tarea asociada)...');
    showLoading();

    try {
        // 1. Obtener todos los siniestros que tienen registro en la tabla tareas
        const { data: tareas, error: errTareas } = await supabaseClient
            .from('seguimientos')
            .select('num_siniestro');
            
        if (errTareas) throw errTareas;
        
        // Crear Set de siniestros con tarea para búsqueda rápida
        const siniestrosConTarea = new Set(tareas.map(t => t.num_siniestro).filter(n => n));
        
        // 2. Obtener todos los expedientes
        const { data: expedientes, error: errExp } = await supabaseClient
            .from('expedientes')
            .select('id, num_siniestro, estado');
            
        if (errExp) throw errExp;
        
        // 3. Identificar huérfanos: Existen en expedientes pero NO en tareas
        const huerfanos = expedientes.filter(e => !siniestrosConTarea.has(e.num_siniestro));
        
        console.log(`📊 Total expedientes: ${expedientes.length}`);
        console.log(`📊 Total tareas: ${tareas.length}`);
        console.log(`⚠️ Huérfanos encontrados: ${huerfanos.length}`);
        
        if (huerfanos.length === 0) {
            alert('✅ No se encontraron expedientes huérfanos. La base de datos es consistente.');
            return;
        }
        
        const confirmMsg = `Se encontraron ${huerfanos.length} expedientes HUÉRFANOS (sin tarea).\n\n` +
                           `Esto suele ocurrir por importaciones fallidas.\n` +
                           `¿Deseas eliminarlos para limpiar la base de datos?`;
                           
        const confirmed = await showConfirmModal(
            'Limpiar Huérfanos',
            confirmMsg,
            'Limpiar',
            'btn-danger'
        );
        if (!confirmed) return;
        
        // 4. Eliminar
        const ids = huerfanos.map(e => e.id);
        const { error: errDel } = await supabaseClient
            .from('expedientes')
            .delete()
            .in('id', ids);
            
        if (errDel) throw errDel;

        alert(`✅ Limpieza completada. Se eliminaron ${ids.length} expedientes huérfanos.`);
        window.location.reload();

    } catch (e) {
        console.error('Error en limpieza:', e);
        alert('Error: ' + e.message);
    } finally {
        hideLoading();
    }
}

/**
 * BORRADO TOTAL: Elimina todos los datos para empezar de cero.
 */
async function resetBaseDeDatos() {
    const confirmed = await requestSecurityConfirmation(
        'BORRADO TOTAL DE BASE DE DATOS',
        'PELIGRO EXTREMO: Estás a punto de BORRAR TODA LA BASE DE DATOS (Expedientes, Tareas, Duplicados).\n\nEsta acción es IRREVERSIBLE y eliminará todo el trabajo realizado.',
        'BORRAR TODO'
    );

    if (!confirmed) {
        showToast('info', 'Cancelado', 'Operación cancelada.');
        return;
    }
    
    showLoading();
    try {
        await supabaseClient.from('seguimientos').delete().neq('id', 0); // Borrar todas las tareas
        await supabaseClient.from('duplicados').delete().neq('id', 0); // Borrar duplicados
        // Borrar expedientes (usando filtro neq id null/uuid-zero para seleccionar todos)
        await supabaseClient.from('expedientes').delete().neq('num_siniestro', 'dummy_value_impossible'); 
        
        alert('Base de datos reseteada correctamente.');
        window.location.reload();
    } catch (e) {
        console.error(e);
        alert('Error al resetear: ' + e.message);
    } finally {
        hideLoading();
    }
}

// Exponer funciones globalmente
window.limpiarExpedientesHuerfanos = limpiarExpedientesHuerfanos;
window.resetBaseDeDatos = resetBaseDeDatos;
window.rebalanceActiveWorkload = rebalanceActiveWorkload;

// ============================================================================
// PAGINACIÓN DE TAREAS
// ============================================================================

function renderTaskPagination(totalTasks) {
    const tableContainer = document.querySelector('#tasks .custom-table');
    let paginationContainer = document.getElementById('taskPagination');
    
    if (!paginationContainer) {
        paginationContainer = document.createElement('div');
        paginationContainer.id = 'taskPagination';
        paginationContainer.className = 'd-flex justify-content-between align-items-center p-3 border-top';
        tableContainer.appendChild(paginationContainer);
    }
    
    const totalPages = Math.ceil(totalTasks / TASKS_PER_PAGE);
    const startItem = totalTasks === 0 ? 0 : (currentTaskPage - 1) * TASKS_PER_PAGE + 1;
    const endItem = Math.min(currentTaskPage * TASKS_PER_PAGE, totalTasks);
    
    paginationContainer.innerHTML = `
        <div class="d-flex align-items-center">
            <div class="text-muted small me-3">
                Mostrando ${startItem}-${endItem} de ${totalTasks} tareas
            </div>
            <button class="btn btn-sm btn-outline-success" onclick="exportTasksToExcel()" title="Exportar tareas filtradas a Excel">
                <i class="bi bi-file-earmark-excel"></i> Exportar Excel
            </button>
        </div>
        <div class="btn-group">
            <button class="btn btn-sm btn-outline-secondary" onclick="loadTasksPage(${currentTaskPage - 1})" ${currentTaskPage <= 1 ? 'disabled' : ''}>
                <i class="bi bi-chevron-left"></i> Anterior
            </button>
            <button class="btn btn-sm btn-outline-secondary" disabled>
                Página ${currentTaskPage} de ${totalPages || 1}
            </button>
            <button class="btn btn-sm btn-outline-secondary" onclick="loadTasksPage(${currentTaskPage + 1})" ${currentTaskPage >= totalPages ? 'disabled' : ''}>
                Siguiente <i class="bi bi-chevron-right"></i>
            </button>
        </div>
    `;
}

function loadTasksPage(page) {
    currentTaskPage = page;
    loadTasks();
}

// Helper para construir la query de tareas (DRY)
async function buildTasksQuery() {
    let query = supabaseClient.from('seguimientos').select('*', { count: 'exact' });
    
    // FILTRO POR ROL
    if (currentUser && !currentUser.isAdmin) {
        query = query.or(`responsable.eq.${currentUser.name},responsable.eq.${currentUser.email}`);
    }
    
    // Aplicar filtros activos
    if (activeTaskFilters.responsable) query = query.eq('responsable', activeTaskFilters.responsable);
    if (activeTaskFilters.estado) query = query.eq('estado', activeTaskFilters.estado);
    if (activeTaskFilters.prioridad) query = query.eq('prioridad', activeTaskFilters.prioridad);
    
    // Filtro de búsqueda
    const searchInput = document.getElementById('taskSearchInput');
    const searchTerm = searchInput ? searchInput.value.trim() : '';
    
    if (searchTerm) {
         let sgrSiniestros = [];
        const { data: sgrMatches } = await supabaseClient
            .from('expedientes')
            .select('num_siniestro')
            .ilike('num_sgr', `%${searchTerm}%`)
            .limit(20);
            
        if (sgrMatches && sgrMatches.length > 0) {
            sgrSiniestros = sgrMatches.map(e => e.num_siniestro);
        }

        let orConditions = [`num_siniestro.ilike.%${searchTerm}%`, `descripcion.ilike.%${searchTerm}%`];
        if (sgrSiniestros.length > 0) {
            sgrSiniestros.forEach(sin => orConditions.push(`num_siniestro.eq.${sin}`));
        }
        
        query = query.or(orConditions.join(','));
    }
    return query;
}

async function exportTasksToExcel() {
    console.log('Exporting tasks...');
    showLoading();

    try {
        // Usar el constructor de query centralizado
        const query = await buildTasksQuery();
        
        // Añadir límite de seguridad para evitar crashes en navegador
        const { data: tasks, error } = await query
            .order('fecha_limite', { ascending: true })
            .limit(2000);

        if (error) throw error;

        if (!tasks || tasks.length === 0) {
            showToast('warning', 'Sin datos', 'No hay tareas para exportar con los filtros actuales.');
            return;
        }

        // Preparar datos para Excel
        const exportData = tasks.map(t => ({
            'Nº Siniestro': t.num_siniestro || '',
            'Descripción': t.descripcion || '',
            'Responsable': t.responsable || '',
            'Estado': t.estado || '',
            'Prioridad': t.prioridad || '',
            'Fecha Límite': t.fecha_limite ? new Date(t.fecha_limite).toLocaleDateString() : '',
            'Importe Recobrado': t.importe_recobrado || 0
        }));

        // Generar Excel
        // Obtener configuración para el nombre de la empresa
        const config = JSON.parse(localStorage.getItem('gescon360_generalConfig')) || {};
        const companyName = config.companyName || 'GESCON 360';

        const worksheet = XLSX.utils.json_to_sheet(exportData, { origin: 'A4' });
        XLSX.utils.sheet_add_aoa(worksheet, [
            [companyName],
            ['Listado de Tareas'],
            [`Generado: ${new Date().toLocaleDateString()}`]
        ], { origin: 'A1' });

        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Tareas");

        const fileName = `Tareas_Gescon360_${new Date().toISOString().split('T')[0]}.xlsx`;
        XLSX.writeFile(workbook, fileName);

        showToast('success', 'Exportado', 'Tareas exportadas correctamente.');

    } catch (error) {
        console.error('Error exporting tasks:', error);
        showToast('danger', 'Error', 'Error al exportar tareas: ' + error.message);
    } finally {
        hideLoading();
    }
}

function searchTasks() {
    currentTaskPage = 1;
    loadTasks();
}

// ============================================================================
// FASE 3: FUNCIONES DE DISTRIBUCIÓN DE CARGA (WorkloadService)
// ============================================================================

// Función para distribuir equitativamente
async function distributeWorkloadEquitably() {
  const confirmed = await showConfirmModal('Distribuir Carga', '¿Distribuir equitativamente todas las tareas sin asignar?', 'Distribuir', 'btn-primary');
  if (!confirmed) return;
  
  showLoading();
  try {
    const session = await supabaseClient.auth.getSession();
    const token = session?.data?.session?.access_token;
    
    if (!token) throw new Error('No hay sesión activa');

    // Obtener expedientes sin asignar
    const response = await fetch('/api/expedientes?gestor_id=null', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (!response.ok) throw new Error('Error al obtener expedientes pendientes');

    const result = await response.json();
    const data = Array.isArray(result) ? result : (Array.isArray(result?.data) ? result.data : []);
    
    if (!data || data.length === 0) {
      showToast('info', 'Info', 'No hay expedientes sin asignar');
      return;
    }
    
    const expedienteIds = data.map(e => e.id);
    
    const distResponse = await fetch('/api/workload/distribute-equitably', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ expedienteIds })
    });

    if (!distResponse.ok) {
        const err = await distResponse.json().catch(() => ({}));
        throw new Error(err.error || 'Error en la distribución');
    }
    
    const distResult = await distResponse.json();
    showToast('success', 'Éxito', distResult.message || 'Carga distribuida correctamente');
    // Recargar vistas
    loadWorkloadStats();
    loadDashboardStats();

  } catch (error) {
    console.error('Error distribuyendo:', error);
    showToast('danger', 'Error', error.message);
  } finally {
    hideLoading();
  }
}

// Exponer funciones globalmente
window.distributeWorkloadEquitably = distributeWorkloadEquitably;
window.loadWorkloadStats = loadWorkloadStats;
