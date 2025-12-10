// =============================================================================
// GESCON 360 - Frontend JavaScript (completo y corregido)
// =============================================================================
// Resumen:
// - No hay llamadas inseguras a Admin API desde el cliente.
// - registerFirstUser es NO-OP (seguro).
// - addUserSecurity llama a endpoint server-side (ADMIN_API_URL).
// - loadCurrentUserProfile obtiene role/status desde 'profiles'.
// - isCurrentUserAdmin usa currentUser.role si está disponible.
// - showToast tiene fallback si bootstrap no está presente.
// =============================================================================

// Configuración de Supabase
const SUPABASE_URL = 'https://bytvzgxcemhlnuggwqno.supabase.co';
// IMPORTANTE: usa la anon public key en el cliente, NUNCA la service_role
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

    // Si bootstrap está disponible, usar su Toast; si no, fallback simple
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

    // Fallback sencillo: mostrar y auto-eliminar
    try {
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
            // Warning possible when no row exists
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
            // eslint-disable-next-line no-alert
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
const ADMIN_ROLE = 'admin';
const USER_ROLE = 'user';

// Prefer role stored in profile; fallback to ADMIN_EMAIL for bootstrapping
function isCurrentUserAdmin() {
    if (!currentUser) return false;
    if (currentUser.role) return currentUser.role === 'admin' || currentUser.role === 'superadmin';
    return currentUser.email === ADMIN_EMAIL;
}

function checkSecurityPermission(requiredRole = ADMIN_ROLE) {
    if (!currentUser) {
        showToast('danger', 'Error', 'No estás autenticado');
        return false;
    }
    if (requiredRole === ADMIN_ROLE && !isCurrentUserAdmin()) {
        showToast('danger', 'Acceso Denegado', 'Solo administradores pueden realizar esta acción');
        console.warn(`Acceso denegado para ${currentUser.email}: se requiere rol ${requiredRole}`);
        return false;
    }
    return true;
}

// UI restrictions
function enforceSecurityUIRestrictions() {
    const securityTable = document.getElementById('securityTable');
    const addUserBtn = document.getElementById('addUserSecurityBtn');
    if (securityTable) securityTable.style.display = isCurrentUserAdmin() ? 'table' : 'none';
    if (addUserBtn) addUserBtn.style.display = isCurrentUserAdmin() ? 'block' : 'none';
}

// Generate temporary password
function generateTemporaryPassword() {
    const length = 12;
    const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%';
    let password = '';
    for (let i = 0; i < length; i++) {
        password += charset.charAt(Math.floor(Math.random() * charset.length));
    }
    return password;
}

// ============================================================================
// SECURITY TABLE / USERS MANAGEMENT (CLIENT SIDE)
// ============================================================================

// Load security and access management table
async function loadSecurityTable() {
    if (!checkSecurityPermission()) return;
    console.log('Loading Security Table...');
    showLoading();
    try {
        const { data: users, error } = await supabaseClient
            .from('profiles')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;
        usersData = users || [];
        renderSecurityTable();
        setupSecurityTableEventListeners();
    } catch (error) {
        console.error('Error loading security table:', error);
        showToast('danger', 'Error', 'No se pudo cargar la tabla de seguridad: ' + (error.message || error));
    } finally {
        hideLoading();
    }
}

// Render security table in the UI
function renderSecurityTable() {
    const tbody = document.querySelector('#securityTable tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (usersData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No hay usuarios registrados</td></tr>';
        return;
    }
    usersData.forEach(user => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${user.id || 'N/A'}</td>
            <td>${user.full_name || (user.email ? user.email.split('@')[0] : '')}</td>
            <td>${user.email}</td>
            <td><span class="badge badge-${user.role === 'admin' ? 'danger' : 'info'}">${user.role || 'user'}</span></td>
            <td><span class="badge badge-${user.status === 'active' ? 'success' : 'secondary'}">${user.status || 'inactive'}</span></td>
            <td>
                <button class="btn btn-sm btn-warning" onclick="editUserSecurity('${user.id}')">Editar</button>
                <button class="btn btn-sm btn-danger" onclick="deleteUserSecurity('${user.id}')">Eliminar</button>
            </td>
        `;
        tbody.appendChild(row);
    });
    enforceSecurityUIRestrictions();
}

// Setup event listeners for security table
function setupSecurityTableEventListeners() {
    const addUserBtn = document.getElementById('addUserSecurityBtn');
    if (addUserBtn) {
        addUserBtn.addEventListener('click', showAddUserDialog);
    }
}

// Show dialog to add new user
function showAddUserDialog() {
    const name = prompt('Nombre completo del usuario:');
    if (!name) return;
    const email = prompt('Correo electrónico (debe ser @gescon360.es):');
    if (!email) return;
    if (!email.endsWith('@gescon360.es')) {
        showToast('danger', 'Error', 'El dominio debe ser @gescon360.es');
        return;
    }
    const role = confirm('¿Es administrador? (Aceptar para Admin, Cancelar para Usuario)');
    addUserSecurity(name, email, role ? 'admin' : 'user');
}

// Add new user to system (client) - ahora llama a endpoint server-side seguro
async function addUserSecurity(fullName, email, role = 'user') {
    if (!checkSecurityPermission()) return;
    console.log('Adding user (client) via server endpoint:', email, 'role:', role);
    showLoading();

    try {
        // Generate a temporary password client-side (server can also generate)
        const tempPassword = generateTemporaryPassword();

        // Call server endpoint to create user (server must use service_role key)
        const response = await fetch(`${ADMIN_API_URL}/admin/create-user`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fullName, email, role, tempPassword })
        });

        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.error || JSON.stringify(result));
        }

        showToast('success', 'Éxito', `Usuario ${email} creado. Contraseña temporal: ${result.tempPassword || tempPassword}`);
        await loadSecurityTable();
    } catch (error) {
        console.error('Error adding user (client):', error);
        showToast('danger', 'Error', 'No se pudo crear el usuario: ' + (error.message || error));
    } finally {
        hideLoading();
    }
}

// Edit user
async function editUserSecurity(userId) {
    if (!checkSecurityPermission()) return;
    const user = usersData.find(u => u.id === userId);
    if (!user) return;
    const newRole = confirm(`Cambiar rol de ${user.email}? (Aceptar para Admin, Cancelar para Usuario)`);
    const newStatus = confirm(`¿Activar usuario? (Aceptar para Activo, Cancelar para Inactivo)`);
    showLoading();
    try {
        const { error } = await supabaseClient
            .from('profiles')
            .update({ role: newRole ? 'admin' : 'user', status: newStatus ? 'active' : 'inactive' })
            .eq('id', userId);

        if (error) throw error;
        showToast('success', 'Éxito', 'Usuario actualizado correctamente');
        loadSecurityTable();
    } catch (error) {
        console.error('Error updating user:', error);
        showToast('danger', 'Error', 'No se pudo actualizar el usuario: ' + (error.message || error));
    } finally {
        hideLoading();
    }
}

// Delete user (only removes profile here; deleting auth user must be server-side)
async function deleteUserSecurity(userId) {
    if (!checkSecurityPermission()) return;
    if (!confirm('¿Está seguro de que desea eliminar este usuario?')) return;
    showLoading();
    try {
        const { error: profileError } = await supabaseClient
            .from('profiles')
            .delete()
            .eq('id', userId);

        if (profileError) throw profileError;
        showToast('success', 'Éxito', 'Usuario eliminado correctamente');
        loadSecurityTable();
    } catch (error) {
        console.error('Error deleting user:', error);
        showToast('danger', 'Error', 'No se pudo eliminar el usuario: ' + (error.message || error));
    } finally {
        hideLoading();
    }
}

// Initialize app after login
async function initializeApp() {
    console.log('Initializing app...');
    try {
        // Add initialization calls here
    } catch (error) {
        console.error('Error initializing app:', error);
    }
}

// ============================================================================
// ADMIN ROLE MANAGEMENT (CLIENT SIDE)
// ============================================================================

/**
 * Cambiar rol de administrador de un usuario (client -> server endpoint)
 * @param {string} targetUserId - ID del usuario a modificar
 * @param {boolean} makeAdmin - true para promover, false para revocar
 */
async function setAdminRole(targetUserId, makeAdmin) {
  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    const accessToken = session?.access_token;
    if (!accessToken) throw new Error('No hay sesión activa');

    const response = await fetch(`${ADMIN_API_URL}/admin/set-admin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify({ targetUserId, makeAdmin })
    });

    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Error al cambiar rol');
    console.log('✓ Rol actualizado:', result);
    return result;
  } catch (error) {
    console.error('Error cambiando rol de administrador:', error);
    throw error;
  }
}

/**
 * Verificar si el usuario actual es administrador (server-side check)
 */
async function checkIfCurrentUserIsAdmin() {
  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) return false;

    const response = await fetch(`${ADMIN_API_URL}/admin/check`, {
      headers: { 'Authorization': `Bearer ${session.access_token}` }
    });

    const result = await response.json();
    return result.isAdmin === true;
  } catch (error) {
    console.error('Error verificando rol de administrador:', error);
    return false;
  }
}

// UI handler for admin button
async function handleAdminButtonClick(userId, currentlyAdmin) {
  try {
    const action = currentlyAdmin ? 'revocar' : 'promover';
    if (!confirm(`¿Estás seguro de ${action} permisos de administrador para este usuario?`)) return;
    const result = await setAdminRole(userId, !currentlyAdmin);
    showToast('success', 'Éxito', result.message || 'Rol actualizado');
  } catch (error) {
    showToast('danger', 'Error', error.message || 'Error cambiando rol');
  }
}

// Inicialización: verificar si usuario actual es admin al cargar la página
async function initializeAdminUI() {
  const isAdmin = await checkIfCurrentUserIsAdmin();
  if (isAdmin) {
    console.log('✓ Usuario actual tiene permisos de administrador');
    document.querySelectorAll('.admin-only').forEach(el => { el.style.display = 'block'; });
  } else {
    console.log('Usuario actual NO es administrador');
    document.querySelectorAll('.admin-only').forEach(el => { el.style.display = 'none'; });
  }
}

// ============================================================================
// PLACEHOLDER UI FUNCTIONS (remain unchanged)
// ============================================================================

function searchExpedients() {
    console.log('Función searchExpedients llamada');
    showToast('info', 'En desarrollo', 'La función de búsqueda de expedientes está en desarrollo.');
}

function clearSearch() {
    console.log('Función clearSearch llamada');
    const fields = ['searchExpedient','searchPolicy','searchSGR','searchDNI'];
    fields.forEach(id => { const el = document.getElementById(id); if(el) el.value=''; });
    const res = document.getElementById('searchResults');
    if (res) res.style.display = 'none';
    showToast('info', 'Limpio', 'Los campos de búsqueda han sido limpiados.');
}

function advancedSearch() {
    console.log('Función advancedSearch llamada');
    showToast('info', 'En desarrollo', 'La búsqueda avanzada estará disponible próximamente.');
}

function addNewTask() {
    console.log('Función addNewTask llamada');
    const modal = document.getElementById('taskModal');
    if (modal) modal.classList.add('active');
}

function saveTask() {
    console.log('Función saveTask llamada');
    showToast('info', 'En desarrollo', 'La función para guardar tareas está en desarrollo.');
    closeModal('taskModal');
}

function filterTasks() {
    console.log('Función filterTasks llamada');
    showToast('info', 'En desarrollo', 'El filtrado de tareas estará disponible próximamente.');
}

function processAllDuplicates() {
    console.log('Función processAllDuplicates llamada');
    showToast('info', 'En desarrollo', 'Procesamiento masivo de duplicados en desarrollo.');
}

function deleteAllDuplicates() {
    console.log('Función deleteAllDuplicates llamada');
    showToast('info', 'En desarrollo', 'Eliminación masiva de duplicados en desarrollo.');
}

function addUser() {
    console.log('Función addUser llamada');
    const modal = document.getElementById('userModal');
    if (modal) modal.classList.add('active');
}

function saveUser() {
    console.log('Función saveUser llamada');
    showToast('info', 'En desarrollo', 'La función para guardar usuarios está en desarrollo.');
    closeModal('userModal');
}

function addResponsible() {
    console.log('Función addResponsible llamada');
    const modal = document.getElementById('responsibleModal');
    if (modal) modal.classList.add('active');
}

function saveResponsible() {
    console.log('Función saveResponsible llamada');
    showToast('info', 'En desarrollo', 'La función para guardar responsables está en desarrollo.');
    closeModal('responsibleModal');
}

function distributeWorkload() {
    console.log('Función distributeWorkload llamada');
    showToast('success', 'Distribución', 'La carga de trabajo se ha distribuido equitativamente (simulado).');
}

function resetWorkloadConfig() {
    console.log('Función resetWorkloadConfig llamada');
    showToast('info', 'Restablecido', 'La configuración de carga de trabajo ha sido restablecida a sus valores predeterminados.');
}

function saveWorkloadConfig() {
    console.log('Función saveWorkloadConfig llamada');
    showToast('success', 'Guardado', 'La configuración de carga de trabajo ha sido guardada correctamente (simulado).');
}

function resetLimits() {
    console.log('Función resetLimits llamada');
    showToast('info', 'Restablecido', 'Los límites del sistema han sido restablecidos a sus valores predeterminados.');
}

function saveLimits() {
    console.log('Función saveLimits llamada');
    showToast('success', 'Guardado', 'Los límites del sistema han sido guardados correctamente (simulado).');
}

function exportReport() {
    console.log('Función exportReport llamada');
    showToast('info', 'En desarrollo', 'La función de exportación de reportes estará disponible próximamente.');
}

function searchArchive() {
    console.log('Función searchArchive llamada');
    showToast('info', 'En desarrollo', 'La búsqueda en el archivo estará disponible próximamente.');
}

function viewArchived(id) {
    console.log('Función viewArchived llamada para:', id);
    showToast('info', 'En desarrollo', `La vista detallada del expediente ${id} estará disponible próximamente.`);
}

function restoreExpedient(id) {
    console.log('Función restoreExpedient llamada para:', id);
    if (confirm(`¿Está seguro de que desea restaurar el expediente ${id}?`)) {
        showToast('success', 'Restaurado', `El expediente ${id} ha sido restaurado (simulado).`);
    }
}

function resetConfig() {
    console.log('Función resetConfig llamada');
    showToast('info', 'Restablecido', 'La configuración del sistema ha sido restablecida.');
}

function saveConfig() {
    console.log('Función saveConfig llamada');
    showToast('success', 'Guardado', 'La configuración del sistema ha sido guardada correctamente (simulado).');
}

function previewImport() {
    console.log('Función previewImport llamada');
    showToast('info', 'En desarrollo', 'La vista previa de importación estará disponible próximamente.');
}

function importarExpedientes() {
    console.log('Función importarExpedientes llamada');
    showToast('info', 'En desarrollo', 'La función de importación de expedientes está en desarrollo.');
}

function openDatePicker(element, id) {
    console.log('Función openDatePicker llamada para:', id);
    showToast('info', 'En desarrollo', 'El selector de fecha estará disponible próximamente.');
}

// =============================================================================
// NAV / UI HELPERS (unchanged)
// =============================================================================

function showSection(sectionId) {
    document.querySelectorAll('.content-section').forEach(section => { section.classList.remove('active'); });
    document.querySelectorAll('.sidebar-menu a').forEach(link => { link.classList.remove('active'); });
    const targetSection = document.getElementById(sectionId);
    if (targetSection) targetSection.classList.add('active');
    const activeLink = document.querySelector(`.sidebar-menu a[onclick="showSection('${sectionId}')"]`);
    if (activeLink) activeLink.classList.add('active');
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
    }
}

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.classList.toggle('active');
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.remove('active');
}

function showNotifications() {
    const modal = document.getElementById('notificationModal');
    if (modal) modal.classList.add('active');
}

// =============================================================================
// FIN
// =============================================================================



