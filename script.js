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

// Configuración de Supabase
const SUPABASE_URL = 'https://atgzvhyuhynvjdljhlon.supabase.co';
// !IMPORTANTE! Reemplaza 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF0Z3p2aHl1aHludmpkbGpobG9uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzM1ODg5MjQsImV4cCI6MjA0OTE2NDkyNH0.wvyNH7VFBMr-TcCvd8WXnLqx-KsqV4qyMPHTRXKYWP4' con tu clave real de Supabase
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF0Z3p2aHl1aHludmpkbGpobG9uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzM1ODg5MjQsImV4cCI6MjA0OTE2NDkyNH0.wvyNH7VFBMr-TcCvd8WXnLqx-KsqV4qyMPHTRXKYWP4';

// Inicializar cliente de Supabase
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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

// Responsible persons data
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
    toastElement.addEventListener('hidden.bs.toast', function() {
        toastElement.remove();
    });
}

// Initialize Application
document.addEventListener('DOMContentLoaded', function() {
    // Visual debugger desactivado
    console.log('Application initialized');
    
    // Check if user is already logged in
    checkAuthStatus();
    
    // Setup event listeners
    setupEventListeners();
    
    // Configurar el contador de caracteres para el campo de descripción
    setupCharCounter();
    
    // Configurar la lógica de estados y archivado
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
                archiveOption.style.display = 'block'; // Muestra la opción
            } else {
                archiveOption.style.display = 'none';  // Oculta la opción
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
            currentUser = {
                email: session.user.email,
                name: session.user.email.split('@')[0],
                id: session.user.id
            };
            showApp();
            initializeApp();
        } else {
            showAuth();
        }
    } catch (error) {
        console.error('Error checking auth status:', error);
        hideLoading();
        showAuth();
    }
}

// Check if there are registered users
function checkUsers() {
    console.log('Checking if users exist...');
    
    // ESTA FUNCIÓN DEBERÁ SER REEMPLAZADA
    // Por ahora, simulamos que no hay usuarios para mostrar la alerta.
    const loginAlert = document.getElementById('loginAlert');
    if (loginAlert) {
        loginAlert.style.display = 'flex';
    }
}

// Setup event listeners
function setupEventListeners() {
    console.log('Setting up event listeners...');
    
    // Login form
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', function(e) {
            e.preventDefault();
            console.log('Login form submitted');
            login();
        });
    }
    
    // Toggle password visibility
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
    document.getElementById('authContainer').classList.remove('d-none');
    document.getElementById('appContainer').classList.add('d-none');
}

function showApp() {
    console.log('Showing app container');
    document.getElementById('authContainer').classList.add('d-none');
    document.getElementById('appContainer').classList.remove('d-none');
}

// Login function
async function login() {
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;

    // Validate domain
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
        const { data, error } = await supabaseClient.auth.signInWithPassword({
            email: email,
            password: password
        });

        if (error) throw error;

        // Hide loading
        loginButtonText.classList.remove('d-none');
        loginSpinner.classList.add('d-none');
        loginButton.disabled = false;

        if (data.user) {
            currentUser = {
                email: data.user.email,
                name: data.user.email.split('@')[0],
                id: data.user.id
            };
            showApp();
            initializeApp();
            hideCreateAdminButton(); // Hide admin button after login
            showToast('success', 'Bienvenido', 'Has iniciado sesión correctamente');
        }
    } catch (error) {
        console.error('Login error:', error);
        loginButtonText.classList.remove('d-none');
        loginSpinner.classList.add('d-none');
        loginButton.disabled = false;
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
        // Even if there's an error, clear the local session
        currentUser = null;
        showAuth();
        showToast('info', 'Sesión cerrada', 'Has cerrado sesión correctamente');
    }
}

// Función temporal para crear el primer usuario admin
async function registerFirstUser() {
    console.log('Registrando primer usuario admin...');
  
    try {
        const { data, error } = await supabaseClient.auth.admin.createUser({
            email: 'jesus.mp@gescon360.es',
            password: 'Gescon360Admin',
            email_confirm: true  // Esto marca el email como confirmado automáticamente
        });

        if (error) {
            console.error('Error creando usuario:', error);
            showToast('danger', 'Error', 'No se pudo crear el usuario: ' + error.message);
        } else {
            console.log('Usuario creado:', data);
            showToast('success', 'Éxito', 'Usuario admin creado correctamente. Ahora puedes iniciar sesión.');
        }
    } catch (error) {
        console.error('Error en registerFirstUser:', error);
        showToast('danger', 'Error', 'Error al crear usuario: ' + error.message);
    }
}

// ============================================================================
// FUNCIONES DE NAVEGACIÓN E INTERACCIÓN DE LA UI (AÑADIDAS PARA CORREGIR ERRORES)
// ============================================================================

// Muestra una sección específica y oculta las demás
function showSection(sectionId) {
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

function searchExpedients() {
    console.log('Función searchExpedients llamada');
    showToast('info', 'En desarrollo', 'La función de búsqueda de expedientes está en desarrollo.');
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
    showToast('info', 'En desarrollo', 'La búsqueda avanzada estará disponible próximamente.');
}

function addNewTask() {
    console.log('Función addNewTask llamada');
    const modal = document.getElementById('taskModal');
    if (modal) {
        modal.classList.add('active');
    }
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
    if (modal) {
        modal.classList.add('active');
    }
}

function saveUser() {
    console.log('Función saveUser llamada');
    showToast('info', 'En desarrollo', 'La función para guardar usuarios está en desarrollo.');
    closeModal('userModal');
}

function addResponsible() {
    console.log('Función addResponsible llamada');
    const modal = document.getElementById('responsibleModal');
    if (modal) {
        modal.classList.add('active');
    }
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


// ============================================================================
// CONTROL DE ACCESO Y ROLES (ROLE-BASED ACCESS CONTROL - RBAC)
// ============================================================================

// Constantes
const ADMIN_EMAIL = 'jesus.mp@gescon360.es';
const ADMIN_ROLE = 'admin';
const USER_ROLE = 'user';

// Verificar si usuario actual es admin
function isCurrentUserAdmin() {
    if (!currentUser) return false;
    return currentUser.email === ADMIN_EMAIL;
}

// Verificar permiso para operación de seguridad
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

// Ocultar elementos de seguridad para usuarios no-admin
function enforceSecurityUIRestrictions() {
    const securityTable = document.getElementById('securityTable');
    const addUserBtn = document.getElementById('addUserSecurityBtn');
    
    if (securityTable) {
        if (isCurrentUserAdmin()) {
            securityTable.style.display = 'table';
        } else {
            securityTable.style.display = 'none';
        }
    }
    
    if (addUserBtn) {
        if (isCurrentUserAdmin()) {
            addUserBtn.style.display = 'block';
        } else {
            addUserBtn.style.display = 'none';
        }
    }
}

// Generar contraseña temporal fuerte
function generateTemporaryPassword() {
    const length = 12;
    const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%';
    let password = '';
    for (let i = 0; i < length; i++) {
        password += charset.charAt(Math.floor(Math.random() * charset.length));
    }
    return password;
}

// TABLA DE SEGURIDAD Y ACCESO - GESTIÓN DE USUARIOS Y PERMISOS
// ============================================================================

// Load security and access management table
async function loadSecurityTable() {
        // Check permission to load security table
    if (!checkSecurityPermission()) return;
    console.log('Loading Security Table...');
    showLoading();
    
    try {
        // Fetch all users from Supabase
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
        showToast('danger', 'Error', 'No se pudo cargar la tabla de seguridad: ' + error.message);
    } finally {
        hideLoading();
    }
}

// Render security table in the UI
function renderSecurityTable() {
    const tbody = document.querySelector('#securityTable tbody');
    if (!tbody) {
        console.warn('Security table tbody not found');
        return;
    }
    
    tbody.innerHTML = '';
    
    if (usersData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No hay usuarios registrados</td></tr>';
        return;
    }
    
    usersData.forEach(user => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${user.id || 'N/A'}</td>
            <td>${user.full_name || user.email.split('@')[0]}</td>
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
        
    // Enforce UI restrictions based on user role
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

// Add new user to system
async function addUserSecurity(fullName, email, role = 'user') {
        // Check permission to add users
    if (!checkSecurityPermission()) return;
    console.log('Adding user:', email, 'with role:', role);
    showLoading();
    
    try {
        // Generate temporary password
        const tempPassword = Math.random().toString(36).substr(2, 9) + 'Gs360!';
        
        // Create user in Supabase Auth
        const { data: authUser, error: authError } = await supabaseClient.auth.admin.createUser({
            email: email,
            password: tempPassword,
            email_confirm: true
        });
        
        if (authError) throw authError;
        
        // Create profile record
        const { error: profileError } = await supabaseClient
            .from('profiles')
            .insert({
                id: authUser.user.id,
                full_name: fullName,
                email: email,
                role: role,
                status: 'active',
                created_at: new Date().toISOString()
            });
        
        if (profileError) throw profileError;
        
        showToast('success', 'Éxito', `Usuario ${email} creado. Contraseña temporal: ${tempPassword}`);
        loadSecurityTable();
        
    } catch (error) {
        console.error('Error adding user:', error);
        showToast('danger', 'Error', 'No se pudo crear el usuario: ' + error.message);
    } finally {
        hideLoading();
    }
}

// Edit user
async function editUserSecurity(userId) {
        // Check permission to edit users
    if (!checkSecurityPermission()) return;
    const user = usersData.find(u => u.id === userId);
    if (!user) return;
    
    const newRole = confirm(`Cambiar rol de ${user.email}? (Aceptar para Admin, Cancelar para Usuario)`);
    const newStatus = confirm(`¿Activar usuario? (Aceptar para Activo, Cancelar para Inactivo)`);
    
    showLoading();
    
    try {
        const { error } = await supabaseClient
            .from('profiles')
            .update({
                role: newRole ? 'admin' : 'user',
                status: newStatus ? 'active' : 'inactive'
            })
            .eq('id', userId);
        
        if (error) throw error;
        
        showToast('success', 'Éxito', 'Usuario actualizado correctamente');
        loadSecurityTable();
        
    } catch (error) {
        console.error('Error updating user:', error);
        showToast('danger', 'Error', 'No se pudo actualizar el usuario: ' + error.message);
    } finally {
        hideLoading();
    }
}

// Delete user
async function deleteUserSecurity(userId) {
        // Check permission to delete users
    if (!checkSecurityPermission()) return;
    if (!confirm('¿Está seguro de que desea eliminar este usuario?')) return;
    
    showLoading();
    
    try {
        // Delete from profiles table
        const { error: profileError } = await supabaseClient
            .from('profiles')
            .delete()
            .eq('id', userId);
        
        if (profileError) throw profileError;
        
        // Delete from auth (optional - requires admin key)
        // For now, just delete from profiles
        
        showToast('success', 'Éxito', 'Usuario eliminado correctamente');
        loadSecurityTable();
        
    } catch (error) {
        console.error('Error deleting user:', error);
        showToast('danger', 'Error', 'No se pudo eliminar el usuario: ' + error.message);
    } finally {
        hideLoading();
    }
}

// Initialize function to load app after login
async function initializeApp() {
    console.log('Initializing app...');
    try {
        // Load initial data
        // loadSecurityTable();
        // enforceSecurityUIRestrictions();
        // Add other initialization calls here
    } catch (error) {
        console.error('Error initializing app:', error);
    }
}






