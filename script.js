// =============================================================================
// GESCON 360 - Frontend JavaScript (actualizado)
// =============================================================================
// Cambios principales:
// - Eliminadas llamadas inseguras a Admin API desde el cliente.
// - registerFirstUser queda como NO-OP por seguridad.
// - addUserSecurity ahora llama a un endpoint server-side seguro (ADMIN_API_URL).
// - Se añade loadCurrentUserProfile() y se usa role desde profiles para controlar permisos.
// - isCurrentUserAdmin usa currentUser.role si está disponible.
// - Integrado loadCurrentUserProfile en checkAuthStatus y login.
// =============================================================================

// Configuración de Supabase
const SUPABASE_URL = 'https://bytvzgxcemhlnuggwqno.supabase.co';
// !IMPORTANTE! Reemplaza la anon key por tu clave pública, NUNCA la service_role en cliente
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ5dHZ6Z3hjZW1obG51Z2d3cW5vIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI3NjA0NTYsImV4cCI6MjA3ODMzNjQ1Nn0.MMDPRCvUDkPFSwvkbUsypKn_TAkwXCXYqsnRiFMihmM';

// Inicializar cliente de Supabase
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// URL del servidor backend (ajusta según tu despliegue). Este servidor debe contener la service_role key.
const ADMIN_API_URL = 'http://localhost:3000'; // Cambiar a tu URL de producción

// Global Variables
let currentSection = 'dashboard';
let currentUser = null;
let expedientesData = [];
let tasksData = [];
let duplicatesData = [];
let currentDate = new Date();
let pickerDate = new Date();
let selectedDateElement = null;
let selectedDateId = null;
let selectedDateValue = null;
let editingResponsibleId = null;
let usersData = [];

// System Limits
let systemLimits = {
    maxFileSize: 10, // MB
    maxConcurrentFiles: 5,
    maxExpedientes: 5000,
    maxActiveTasks: 2000,
    maxArchivedExpedientes: 10000
};

// Responsible persons data (mock)
let responsiblesData = [
    { id: 1, name: 'Juan Pérez', email: 'juan.perez@empresa.com', status: 'available', distribution: 'yes', activeTasks: 5, completedTasks: 23 },
    { id: 2, name: 'María López', email: 'maria.lopez@empresa.com', status: 'vacation', distribution: 'no', activeTasks: 0, completedTasks: 18, returnDate: '2024-12-20' },
    { id: 3, name: 'Carlos Rodríguez', email: 'carlos.rodriguez@empresa.com', status: 'available', distribution: 'yes', activeTasks: 3, completedTasks: 31 },
    { id: 4, name: 'Ana Martínez', email: 'ana.martinez@empresa.com', status: 'sick', distribution: 'no', activeTasks: 0, completedTasks: 15, returnDate: '2024-12-15' }
];

// Visual Debugger - DESACTIVADO
function visualDebugger() {
    // Desactivado para ocultar el panel de depuración
}

// Debug function - DESACTIVADO
function debug(message, type = 'info') {
    // Desactivado para ocultar el panel de depuración
}

// Handle Google Apps Script errors
function handleGASError(error, operation) {
    console.error(`Error in ${operation}: ${error.message}`);
    showToast('danger', 'Error', `Ha ocurrido un error en ${operation}: ${error.message}`);
    hideLoading();
}

// Show/hide loading overlay
function showLoading() {
    const el = document.getElementById('loadingOverlay');
    if (el) el.classList.add('show');
}

function hideLoading() {
    const el = document.getElementById('loadingOverlay');
    if (el) el.classList.remove('show');
}

// Show toast notification (con fallback si bootstrap no está cargado)
function showToast(type, title, message) {
    let toastContainer = document.getElementById('toastContainer');
    if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.id = 'toastContainer';
        toastContainer.className = 'toast-container position-fixed bottom-0 end-0 p-3';
        document.body.appendChild(toastContainer);
    }

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
    const toastElement = document.getElementById(toastId);

    // Si bootstrap está disponible, usar su Toast; si no, fallback a un alert y eliminar el elemento
    if (typeof bootstrap !== 'undefined' && bootstrap && bootstrap.Toast) {
        try {
            const toast = new bootstrap.Toast(toastElement);
            toast.show();
            toastElement.addEventListener('hidden.bs.toast', function() {
                toastElement.remove();
            });
            return;
        } catch (e) {
            console.warn('Bootstrap toast fallo, usando fallback:', e);
        }
    }

    // Fallback simple: mostrar pequeño banner y auto-eliminarlo después de 5s
    try {
        toastElement.classList.add('fallback-toast');
        // Simple styles en línea si no existen estilos
        toastElement.style.background = '#fff';
        toastElement.style.border = '1px solid rgba(0,0,0,0.1)';
        toastElement.style.padding = '0.5rem';
        setTimeout(() => {
            if (toastElement && toastElement.parentNode) toastElement.parentNode.removeChild(toastElement);
        }, 5000);
    } catch (e) {
        // último recurso: alert()
        // eslint-disable-next-line no-alert
        alert(`${title}\n\n${message}`);
        if (toastElement && toastElement.parentNode) toastElement.parentNode.removeChild(toastElement);
    }
}

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
    const toastElement = document.getElementById(toastId);
    const toast = new bootstrap.Toast(toastElement);
    toast.show();
    toastElement.addEventListener('hidden.bs.toast', function() {
        toastElement.remove();
    });
}

// Initialize Application
document.addEventListener('DOMContentLoaded', function() {
    console.log('Application initialized');
    checkAuthStatus();
    setupEventListeners();
    setupCharCounter();
    setupStatusArchiveLogic();
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
                archiveOption.style.display = 'block';
            } else {
                archiveOption.style.display = 'none';
                const cb = document.getElementById('archive-checkbox');
                if (cb) cb.checked = false;
            }
        });
    }
}

// ============================================================================
// AUTH / SESSION HANDLING & PROFILE LOADING
// ============================================================================

// Load current user's profile (from 'profiles' table) and save role/status in currentUser
async function loadCurrentUserProfile(userId) {
    try {
        const { data: profile, error } = await supabaseClient
            .from('profiles')
            .select('id,full_name,email,role,status')
            .eq('id', userId)
            .maybeSingle();

        if (error) {
            console.warn('Warning loading profile:', error.message || error);
        }

        if (profile) {
            currentUser = currentUser || {};
            currentUser.role = profile.role || 'user';
            currentUser.full_name = profile.full_name || currentUser.name;
            currentUser.status = profile.status || 'active';
            return profile;
        }
        return null;
    } catch (err) {
        console.error('Error loading profile:', err);
        return null;
    }
}

// Check authentication status and load profile if logged
async function checkAuthStatus() {
    console.log('Checking authentication status...');
    showLoading();

    try {
        const { data: { session }, error } = await supabaseClient.auth.getSession();
        if (error) throw error;

        hideLoading();

        if (session && session.user) {
            currentUser = {
                email: session.user.email,
                name: session.user.email.split('@')[0],
                id: session.user.id
            };
            await loadCurrentUserProfile(currentUser.id);

            showApp();
            initializeApp();
            initializeAdminUI();
        } else {
            showAuth();
        }
    } catch (error) {
        console.error('Error checking auth status:', error);
        hideLoading();
        showAuth();
    }
}

// ----- Seguridad: deshabilitar la creación de usuarios admin desde el cliente -----
function registerFirstUser(...args) {
    console.warn('registerFirstUser() llamada en cliente bloqueada por seguridad. Use un endpoint server-side para crear usuarios admin.');
    try {
        const alertContainer = document.getElementById('loginAlert') || document.getElementById('debugConsole');
        if (alertContainer) {
            alertContainer.style.display = 'block';
            alertContainer.innerHTML = '<i class="bi bi-exclamation-triangle-fill"></i> La creación de administradores desde el cliente está deshabilitada por seguridad. Contacta con el administrador del sistema.';
        } else {
            alert('La creación de administradores desde el cliente está deshabilitada por seguridad. Contacta con el administrador del sistema.');
        }
    } catch (e) {}
    return Promise.resolve({ error: 'client_creation_disabled' });
}

// Setup event listeners
function setupEventListeners() {
    console.log('Setting up event listeners...');

    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', function(e) {
            e.preventDefault();
            console.log('Login form submitted');
            login();
        });
    }

    const togglePassword = document.getElementById('togglePassword');
    if (togglePassword) {
        togglePassword.addEventListener('click', function() {
            togglePasswordVisibility('loginPassword', 'togglePassword');
        });
    }
}

// Toggle password visibility
function togglePasswordVisibility(inputId, buttonId) {
    const input = document.getElementById(inputId);
    const button = document.getElementById(buttonId);
    if (!input || !button) return;
    const icon = button.querySelector('i');

    if (input.type === 'password') {
        input.type = 'text';
        if (icon) {
            icon.classList.remove('bi-eye');
            icon.classList.add('bi-eye-slash');
        }
    } else {
        input.type = 'password';
        if (icon) {
            icon.classList.remove('bi-eye-slash');
            icon.classList.add('bi-eye');
        }
    }
}

function hideCreateAdminButton() {
    const createAdminBtn = document.getElementById('createAdminButton');
    if (createAdminBtn) createAdminBtn.style.display = 'none';
}

function showAuth() {
    console.log('Showing auth container');
    const a = document.getElementById('authContainer');
    const b = document.getElementById('appContainer');
    if (a) a.classList.remove('d-none');
    if (b) b.classList.add('d-none');
}

function showApp() {
    console.log('Showing app container');
    const a = document.getElementById('authContainer');
    const b = document.getElementById('appContainer');
    if (a) a.classList.add('d-none');
    if (b) b.classList.remove('d-none');
}

// Login function
async function login() {
    const emailEl = document.getElementById('loginEmail');
    const pwdEl = document.getElementById('loginPassword');
    const email = emailEl ? emailEl.value : '';
    const password = pwdEl ? pwdEl.value : '';

    if (!email.endsWith('@gescon360.es')) {
        showToast('danger', 'Error de validación', 'El dominio del correo debe ser @gescon360.es');
        return;
    }

    console.log('Login attempt with email:', email);

    const loginButtonText = document.getElementById('loginButtonText');
    const loginSpinner = document.getElementById('loginSpinner');
    const loginButton = document.getElementById('loginButton');
    if (loginButtonText) loginButtonText.classList.add('d-none');
    if (loginSpinner) loginSpinner.classList.remove('d-none');
    if (loginButton) loginButton.disabled = true;

    try {
        const { data, error } = await supabaseClient.auth.signInWithPassword({
            email: email,
            password: password
        });

        if (error) throw error;

        if (loginButtonText) loginButtonText.classList.remove('d-none');
        if (loginSpinner) loginSpinner.classList.add('d-none');
        if (loginButton) loginButton.disabled = false;

        if (data && data.user) {
            currentUser = {
                email: data.user.email,
                name: data.user.email.split('@')[0],
                id: data.user.id
            };
            await loadCurrentUserProfile(currentUser.id);

            showApp();
            initializeApp();
            initializeAdminUI();
            hideCreateAdminButton();
            showToast('success', 'Bienvenido', 'Has iniciado sesión correctamente');
        }
    } catch (error) {
        console.error('Login error:', error);
        if (loginButtonText) loginButtonText.classList.remove('d-none');
        if (loginSpinner) loginSpinner.classList.add('d-none');
        if (loginButton) loginButton.disabled = false;
        showToast('danger', 'Error de autenticación', error.message || 'Correo o contraseña incorrectos');
    }
}

// Logout function
async function logout() {
    console.log('Logout attempt');
    try {
        const { error } = await supabaseClient.auth.signOut();
        if (error) throw error;
        currentUser = null;
        showAuth();
        showToast('info', 'Sesión cerrada', 'Has cerrado sesión correctamente');
    } catch (error) {
        console.error('Logout error:', error);
        currentUser = null;
        showAuth();
        showToast('info', 'Sesión cerrada', 'Has cerrado sesión correctamente');
    }
}

// ============================================================================
// SECURITY / RBAC HELPERS
// ============================================================================

const ADMIN_EMAIL = 'jesus.mp@gescon360.es';
const


