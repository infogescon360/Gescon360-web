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

// Configuración de Supabase - Se cargarán desde el servidor
let supabaseClient = null;

// Función para cargar configuración y arrancar
async function initAppConfig() {
    try {
        const response = await fetch('/config');
        if (!response.ok) throw new Error('No se pudo cargar la configuración');
        const config = await response.json();

        if (!config.supabaseUrl || !config.supabaseAnonKey) {
            throw new Error('Configuración de Supabase incompleta');
        }

        // Inicializar cliente
        supabaseClient = supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
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
    await logout();
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
    toastElement.addEventListener('hidden.bs.toast', function () {
        toastElement.remove();
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
            // Obtener perfil completo (nombre y rol) desde Supabase
            let fullName = session.user.email.split('@')[0];
            let isAdmin = false;

            try {
                const { data: profile } = await supabaseClient
                    .from('profiles')
                    .select('full_name, role')
                    .eq('id', session.user.id)
                    .single();

                if (profile) {
                    if (profile.full_name) fullName = profile.full_name;
                    if (profile.role === 'admin') isAdmin = true;
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

// ----- Seguridad: deshabilitar la creación de usuarios admin desde el cliente -----
// Reemplaza la implementación actual de registerFirstUser por esta NO-OP segura.
// Si prefieres no sobrescribir, añade esta función al final de script.js para
// que anule la definición previa (la última definición gana en JS).

function registerFirstUser(...args) {
    // Evitar cualquier intento de usar la Admin API desde el navegador.
    console.warn('registerFirstUser() llamada en cliente bloqueada por seguridad. Use un endpoint server-side para crear usuarios admin.');
    // Mostrar mensaje amigable al usuario (opcional). Puedes eliminar el alert si no quieres notificaciones.
    try {
        // Intentamos mostrar un mensaje en pantalla si existe un contenedor de alertas
        const alertContainer = document.getElementById('loginAlert') || document.getElementById('debugConsole');
        if (alertContainer) {
            alertContainer.style.display = 'block';
            alertContainer.innerHTML = '<i class="bi bi-exclamation-triangle-fill"></i> La creación de administradores desde el cliente está deshabilitada por seguridad. Contacta con el administrador del sistema.';
        } else {
            // fallback
            // eslint-disable-next-line no-alert
            alert('La creación de administradores desde el cliente está deshabilitada por seguridad. Contacta con el administrador del sistema.');
        }
    } catch (e) {
        // No bloquear la ejecución por errores de UI
    }
    // No realizar ninguna llamada de red ni modificar el estado.
    return Promise.resolve({ error: 'client_creation_disabled' });
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

    // Validar usuario administrador principal
    if (email !== 'jesus.mp@gescon360.es') {
        showToast('danger', 'Acceso restringido', 'En esta fase solo está autorizado el usuario jesus.mp@gescon360.es');
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
            // Guardar sesión
            if (data.session) localStorage.setItem('supabase.auth.token', data.session.access_token);

            // Obtener perfil completo (nombre y rol)
            let fullName = data.user.email.split('@')[0];
            let isAdmin = false;

            try {
                const { data: profile } = await supabaseClient
                    .from('profiles')
                    .select('full_name, role')
                    .eq('id', data.user.id)
                    .single();

                if (profile) {
                    if (profile.full_name) fullName = profile.full_name;
                    if (profile.role === 'admin') isAdmin = true;
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

        // Desuscribirse de Realtime
        if (realtimeSubscription) {
            supabaseClient.removeChannel(realtimeSubscription);
            realtimeSubscription = null;
        }

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
        if (sectionId === 'reports') loadReports();
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
    const status = document.getElementById('advStatus').value;
    const asegurado = document.getElementById('advAsegurado').value.trim();
    const ciaCausante = document.getElementById('advCiaCausante').value.trim();
    const tipoDano = document.getElementById('advTipoDano').value.trim();

    const resultsContainer = document.getElementById('searchResults');
    if (resultsContainer) resultsContainer.style.display = 'none';

    try {
        let query = supabaseClient.from('expedientes').select('*');

        if (dateStart) query = query.gte('fecha_ocurrencia', dateStart);
        if (dateEnd) query = query.lte('fecha_ocurrencia', dateEnd);
        
        if (amountMin) query = query.gte('importe', parseFloat(amountMin));
        if (amountMax) query = query.lte('importe', parseFloat(amountMax));
        
        if (status) query = query.eq('estado', status);
        
        if (asegurado) query = query.ilike('nombre_asegurado', `%${asegurado}%`);
        if (ciaCausante) query = query.ilike('cia_causante', `%${ciaCausante}%`);
        if (tipoDano) query = query.ilike('tipo_dano', `%${tipoDano}%`);

        const { data, error } = await query;

        if (error) throw error;

        renderSearchResults(data);
        
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
    document.getElementById('archive-option').style.display = 'none';
    
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
                        usersData = await response.json();
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
        estado: document.getElementById('taskStatus').value
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
                .from('tareas')
                .update(taskData)
                .eq('id', id);
            error = updateError;
        } else {
            // Insertar
            const { error: insertError } = await supabaseClient
                .from('tareas')
                .insert([taskData]);
            error = insertError;
        }

        if (error) throw error;

        // LÓGICA DE ARCHIVADO AUTOMÁTICO (REQ: Finalizados van a Archivados)
        const finalStates = ['Completada', 'Finalizado', 'Finalizado Parcial', 'Rehusado', 'Datos NO válidos', 'Recobrado'];
        if (finalStates.includes(taskData.estado)) {
            // Actualizar expediente a Archivado
            if (taskData.num_siniestro) {
                await supabaseClient
                    .from('expedientes')
                    .update({ estado: 'Archivado' })
                    .eq('num_siniestro', taskData.num_siniestro);
            }
            // Actualizar tarea a Archivado (para que desaparezca de la lista activa)
            if (id) {
                await supabaseClient
                    .from('tareas')
                    .update({ estado: 'Archivado' })
                    .eq('id', id);
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
        let query = supabaseClient
            .from('tareas')
            .select('*', { count: 'exact' });
        
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
        const errorMsg = error.code === 'PGRST200' 
            ? 'Error de Base de Datos: Falta relación (Foreign Key) entre Tareas y Expedientes.' 
            : 'No se pudieron cargar las tareas. Revisa la consola.';
        tableBody.innerHTML = `<tr><td colspan="11" class="text-center text-danger"><i class="bi bi-exclamation-triangle"></i> ${errorMsg}</td></tr>`;
    } finally {
        hideLoading();
    }
}

async function editTask(id) {
  showLoading();
  try {
    const { data: task, error } = await supabaseClient
      .from('tareas')
      .select('*')
      .eq('id', id)
      .single();
    
    if (error) throw error;
    
    // Obtener SGR del expediente relacionado
    let numSGR = '';
    if (task.num_siniestro) {
      const { data: exp } = await supabaseClient
        .from('expedientes')
        .select('num_sgr')
        .eq('num_siniestro', task.num_siniestro)
        .single();
      if (exp) numSGR = exp.num_sgr;
    }
    
    // Rellenar formulario
    document.getElementById('taskId').value = task.id;
    
    // ✅ CONFIGURAR CAMPO SGR Y GUARDAR REFERENCIA AL SINIESTRO
    const expInput = document.getElementById('taskExpedient');
    const expLabel = document.querySelector("label[for='taskExpedient']");
    if (expLabel) expLabel.textContent = "Nº SGR";  // 👈 CAMBIA EL LABEL
    if (expInput) {
      expInput.value = numSGR || ''; // Mostrar SGR
      expInput.dataset.siniestro = task.num_siniestro || ''; // Guardar Siniestro oculto
      expInput.placeholder = "Ingrese Nº SGR";
    }
    
    document.getElementById('taskResponsible').value = task.responsable || '';
    document.getElementById('taskDescription').value = task.descripcion || '';
    document.getElementById('taskPriority').value = task.prioridad || 'Media';
    document.getElementById('taskDueDate').value = task.fecha_limite || '';
    document.getElementById('taskStatus').value = task.estado || 'Pendiente';
    
    // Actualizar contador
    document.getElementById('char-count').textContent = (task.descripcion || '').length;
    
    // Cargar responsables
    const respSelect = document.getElementById('taskResponsible');
    if (respSelect && respSelect.options.length <= 1) {
      // Asegurar que tenemos datos de usuarios cargados
      if (!usersData || usersData.length === 0) {
          try {
              const session = await supabaseClient.auth.getSession();
              if (session?.data?.session?.access_token) {
                  const response = await fetch('/api/responsables', {
                      headers: { 'Authorization': `Bearer ${session.data.session.access_token}` }
                  });
                  if (response.ok) {
                      usersData = await response.json();
                  }
              }
          } catch (e) {
              console.warn('Error cargando responsables en modal (edit):', e);
          }
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
    
    // Mostrar modal
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
                        usersData = await response.json();
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
    closeModal('filterTasksModal');
    loadTasks();
    showToast('info', 'Filtros aplicados', 'Lista de tareas actualizada.');
}

function clearTaskFilters() {
    activeTaskFilters = {};
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
        console.error('Error loading duplicates:', error);
        tableBody.innerHTML = '<tr><td colspan="8" class="text-center text-muted">No se pudieron cargar los duplicados (¿Tabla "duplicados" existe?)</td></tr>';
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
    if (!confirm('¿Estás seguro de procesar todos los duplicados? Esto actualizará los expedientes existentes con la información de los duplicados.')) return;
    
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

        // Generar tareas para los duplicados procesados (como si fueran importados)
        if (processedExpedients.length > 0) {
             const distribuirEquitativamente = document.getElementById('autoDistributeImport')?.checked ?? true;
             await distribuirTareasImportadas(processedExpedients, distribuirEquitativamente);
        }

        showToast('success', 'Procesado', `${duplicates.length} duplicados han sido procesados y fusionados.`);
        loadDuplicates();
    } catch (error) {
        console.error('Error processing duplicates:', error);
        showToast('danger', 'Error', 'Error al procesar duplicados: ' + error.message);
    } finally {
        hideLoading();
    }
}

async function deleteAllDuplicates() {
    if (!confirm('¿Estás seguro de eliminar todos los registros de duplicados? Esta acción no se puede deshacer.')) return;

    showLoading();
    try {
        const { error } = await supabaseClient
            .from('duplicados')
            .delete()
            .not('id', 'is', null);

        if (error) throw error;

        showToast('success', 'Eliminado', 'Todos los duplicados han sido eliminados.');
        loadDuplicates();
    } catch (error) {
        console.error('Error deleting duplicates:', error);
        showToast('danger', 'Error', 'Error al eliminar duplicados: ' + error.message);
    } finally {
        hideLoading();
    }
}

async function processDuplicate(id) {
    if (!confirm('¿Procesar este duplicado? Se actualizará el expediente original.')) return;
    
    showLoading();
    try {
        // Obtener datos del duplicado
        const { data: dup, error: fetchError } = await supabaseClient
            .from('duplicados')
            .select('*')
            .eq('id', id)
            .single();
            
        if (fetchError) throw fetchError;
        
        // Excluir created_at
        const { id: dupId, fecha_deteccion, veces_repetido, created_at, ...expedientData } = dup;
        
        // Actualizar expediente
        // FIX: Reemplazar upsert con check/update/insert manual
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
            
        if (upsertError) throw upsertError;
        
        // Generar tarea para el duplicado procesado
        const distribuirEquitativamente = document.getElementById('autoDistributeImport')?.checked ?? true;
        await distribuirTareasImportadas([expedientData], distribuirEquitativamente);
        
        // Borrar de duplicados
        await supabaseClient.from('duplicados').delete().eq('id', id);
        
        showToast('success', 'Éxito', 'Duplicado procesado correctamente.');
        loadDuplicates();
    } catch (error) {
        console.error(error);
        showToast('danger', 'Error', error.message);
    } finally {
        hideLoading();
    }
}

async function deleteDuplicate(id) {
    if (!confirm('¿Eliminar este registro de duplicado?')) return;
    
    showLoading();
    try {
        const { error } = await supabaseClient.from('duplicados').delete().eq('id', id);
        if (error) throw error;
        
        showToast('success', 'Eliminado', 'Registro eliminado.');
        loadDuplicates();
    } catch (error) {
        console.error(error);
        showToast('danger', 'Error', error.message);
    } finally {
        hideLoading();
    }
}

function addUser() {
    console.log('Función addUser llamada');
    const form = document.getElementById('userForm');
    if (form) form.reset();
    
    document.getElementById('userId').value = '';
    const emailInput = document.getElementById('userEmail');
    if (emailInput) emailInput.disabled = false; // Permitir editar email al crear

    const modal = document.getElementById('userModal');
    if (modal) {
        modal.classList.add('active');
    }
}

async function saveUser() {
    console.log('Función saveUser llamada');
    
    const id = document.getElementById('userId').value;
    const email = document.getElementById('userEmail').value;
    const fullName = document.getElementById('userFullName').value;
    const role = document.getElementById('userRole').value;
    const status = document.getElementById('userStatus').value;

    if (!email || !fullName) {
        showToast('warning', 'Datos incompletos', 'El email y el nombre son obligatorios.');
        return;
    }

    showLoading();
    try {
        if (id) {
            // Actualizar usuario existente usando el nuevo endpoint del backend
            const { data: { session } } = await supabaseClient.auth.getSession();
            const response = await fetch(`/admin/users/${id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session.access_token}`
                },
                body: JSON.stringify({ fullName, role, status })
            });
            
            if (!response.ok) throw new Error('Error al actualizar usuario');
            
            showToast('success', 'Actualizado', 'Usuario actualizado correctamente');
        } else {
            // Crear nuevo usuario (Llamada al backend)
            const { data: { session } } = await supabaseClient.auth.getSession();
            if (!session) throw new Error('No hay sesión activa');

            const response = await fetch('/admin/users', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session.access_token}`
                },
                body: JSON.stringify({ fullName, email, role })
            });

            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Error al crear usuario');

            alert(`Usuario creado correctamente.\n\nEmail: ${result.email}\nContraseña temporal: ${result.tempPassword}\n\nIMPORTANTE: Copie esta contraseña.`);
            showToast('success', 'Creado', 'Usuario creado correctamente');
        }

        closeModal('userModal');
        loadUsers();
    } catch (error) {
        console.error('Error saving user:', error);
        showToast('danger', 'Error', error.message);
    } finally {
        hideLoading();
    }
}

async function loadUsers() {
    console.log('Cargando usuarios...');
    const tableBody = document.getElementById('usersTable');
    if (!tableBody) return;

    showLoading();
    try {
        // Usar endpoint del backend para evitar errores RLS (500)
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (!session) throw new Error('No hay sesión activa');

        const response = await fetch('/admin/users', {
            headers: { 'Authorization': `Bearer ${session.access_token}` }
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || 'Error al cargar usuarios desde el servidor');
        }
        const users = await response.json();

        tableBody.innerHTML = '';
        if (!users || users.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="7" class="text-center p-4">No hay usuarios registrados.</td></tr>';
        } else {
            users.forEach(user => {
                const row = document.createElement('tr');
                const createdDate = user.created_at ? new Date(user.created_at).toLocaleDateString() : '-';
                const roleClass = user.role === 'admin' ? 'unavailable' : 'proceso'; // Rojo para admin, azul para user
                const statusClass = user.status === 'active' ? 'available' : 'archivado';

                row.innerHTML = `
                    <td><small class="text-muted">${user.id.substring(0, 8)}...</small></td>
                    <td>${user.full_name || '-'}</td>
                    <td>${user.email}</td>
                    <td><span class="status-badge status-${roleClass}">${user.role}</span></td>
                    <td><span class="status-badge status-${statusClass}">${user.status}</span></td>
                    <td>${createdDate}</td>
                    <td>
                        <button class="btn btn-sm btn-outline-primary" onclick="editUser('${user.id}')" title="Editar"><i class="bi bi-pencil"></i></button>
                        <button class="btn btn-sm btn-outline-danger" onclick="deleteUser('${user.id}')" title="Eliminar"><i class="bi bi-trash"></i></button>
                    </td>
                `;
                tableBody.appendChild(row);
            });
        }
    } catch (error) {
        console.error('Error loading users:', error);
        showToast('danger', 'Error', 'Error al cargar usuarios: ' + error.message);
    } finally {
        hideLoading();
    }
}

async function editUser(id) {
    showLoading();
    try {
        const { data: user, error } = await supabaseClient
            .from('profiles')
            .select('*')
            .eq('id', id)
            .single();

        if (error) throw error;

        document.getElementById('userId').value = user.id;
        document.getElementById('userEmail').value = user.email;
        document.getElementById('userEmail').disabled = true; // No permitir cambiar email
        document.getElementById('userFullName').value = user.full_name || '';
        document.getElementById('userRole').value = user.role || 'user';
        document.getElementById('userStatus').value = user.status || 'active';

        const modal = document.getElementById('userModal');
        if (modal) modal.classList.add('active');

    } catch (error) {
        console.error('Error fetching user:', error);
        showToast('danger', 'Error', 'No se pudo cargar el usuario');
    } finally {
        hideLoading();
    }
}

async function deleteUser(id) {
    if (!confirm('¿Estás seguro de eliminar este usuario? Esta acción no se puede deshacer.')) return;

    showLoading();
    try {
        const session = await supabaseClient.auth.getSession();
        if (!session?.data?.session?.access_token) {
            throw new Error('No hay sesión activa');
        }

        const response = await fetch(`/admin/users/${id}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${session.data.session.access_token}`
            }
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || 'Error al eliminar usuario');
        }

        showToast('success', 'Eliminado', 'Usuario eliminado correctamente');
        loadUsers();
    } catch (error) {
        console.error('Error deleting user:', error);
        showToast('danger', 'Error', 'No se pudo eliminar el usuario: ' + error.message);
    } finally {
        hideLoading();
    }
}

async function loadResponsibles() {
    console.log('Cargando responsables...');
    showLoading();
    try {
        const session = await supabaseClient.auth.getSession();
        if (!session?.data?.session?.access_token) {
            throw new Error('No hay sesión activa');
        }

        const response = await fetch('/api/responsables', {
            headers: {
                'Authorization': `Bearer ${session.data.session.access_token}`
            }
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Error al cargar responsables');
        }

        const users = await response.json();
        usersData = users;

        let tasks = [];
        try {
            const { data: t } = await supabaseClient.from('tareas').select('responsable, estado');
            tasks = t || [];
        } catch (e) {
            console.warn('No se pudieron cargar las tareas para estadísticas:', e);
        }

        renderResponsiblesTable(users, tasks);
    } catch (error) {
        console.error('Error loading responsibles:', error);
        showToast('danger', 'Error', error.message);
    } finally {
        hideLoading();
    }
}

function renderResponsiblesTable(users, tasks = []) {
    const container = document.getElementById('responsiblesList');
    if (!container) return;

    // Mapeo de estados para UI
    const statusMap = { 'active': 'Activo', 'inactive': 'Inactivo', 'vacation': 'Vacaciones', 'sick_leave': 'Baja Médica', 'permit': 'Permiso' };
    const classMap = { 'active': 'bg-success', 'inactive': 'bg-secondary', 'vacation': 'bg-warning text-dark', 'sick_leave': 'bg-danger', 'permit': 'bg-info text-dark' };

    // Botón de redistribución manual
    const headerHtml = `<div class="d-flex justify-content-end mb-3"><button class="btn btn-outline-warning btn-sm" onclick="distributeWorkload()"><i class="bi bi-shuffle"></i> Redistribuir Carga de Ausentes</button></div>`;

    const stats = {};
    users.forEach(u => {
        const name = u.full_name || u.email;
        stats[name] = { active: 0, completed: 0 };
    });

    tasks.forEach(t => {
        if (t.responsable && stats[t.responsable]) {
            const isCompleted = ['Completada', 'Recobrado', 'Rehusado NO cobertura'].includes(t.estado);
            if (isCompleted) stats[t.responsable].completed++;
            else stats[t.responsable].active++;
        }
    });

    container.innerHTML = headerHtml;
    if (users.length === 0) {
        container.innerHTML = '<div class="alert alert-info">No hay responsables registrados.</div>';
        return;
    }

    users.forEach(user => {
        const name = user.full_name || user.email;
        const userStats = stats[name] || { active: 0, completed: 0 };
        const statusLabel = statusMap[user.status] || user.status;
        const statusClass = classMap[user.status] || 'bg-secondary';
        
        const card = document.createElement('div');
        card.className = 'responsible-card';
        card.innerHTML = `
            <div class="responsible-header">
                <div>
                    <div class="responsible-name">${name}</div>
                    <div class="responsible-email">${user.email}</div>
                </div>
                <div class="dropdown">
                    <button class="btn btn-sm btn-outline-secondary" type="button" data-bs-toggle="dropdown">
                        <i class="bi bi-three-dots-vertical"></i>
                    </button>
                    <ul class="dropdown-menu">
                        <li><a class="dropdown-item" href="#" onclick="editResponsible('${user.id}')">Editar</a></li>
                        <li><a class="dropdown-item text-danger" href="#" onclick="deleteResponsible('${user.id}')">Eliminar</a></li>
                    </ul>
                </div>
            </div>
            <div class="responsible-status">
                <span class="status-indicator ${statusClass} text-white" style="padding: 4px 8px; border-radius: 4px;">${statusLabel}</span>
            </div>
            <div class="row mt-3 text-center">
                <div class="col-6">
                    <h3>${userStats.active}</h3>
                    <small class="text-muted">Tareas Activas</small>
                </div>
                <div class="col-6">
                    <h3>${userStats.completed}</h3>
                    <small class="text-muted">Completadas</small>
                </div>
            </div>
        `;
        container.appendChild(card);
    });
}

function addResponsible() {
    console.log('Función addResponsible llamada');
    const form = document.getElementById('responsibleForm');
    if (form) form.reset();
    
    document.getElementById('respId').value = '';
    const emailInput = document.getElementById('respEmail');
    if (emailInput) emailInput.disabled = false;

    const modal = document.getElementById('responsibleModal');
    if (modal) {
        modal.classList.add('active');
    }
}

async function saveResponsible() {
    console.log('Guardando responsable...');
    const id = document.getElementById('respId').value;
    const email = document.getElementById('respEmail').value;
    const fullName = document.getElementById('respName').value;
    const status = document.getElementById('respStatus').value;
    const role = document.getElementById('respRole').value;

    if (!email || !fullName) {
        showToast('warning', 'Datos incompletos', 'Email y Nombre son obligatorios');
        return;
    }

    showLoading();
    try {
        if (id) {
            // Update
            const { error } = await supabaseClient
                .from('profiles')
                .update({ full_name: fullName, status, role })
                .eq('id', id);
            
            if (error) throw error;
            showToast('success', 'Actualizado', 'Responsable actualizado correctamente');
        } else {
            // Create new user via backend
            const { data: { session } } = await supabaseClient.auth.getSession();
            if (!session) throw new Error('No hay sesión activa');

            const response = await fetch('/admin/users', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session.access_token}`
                },
                body: JSON.stringify({ fullName, email, role })
            });

            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Error al crear usuario');

            alert(`Responsable creado.\nEmail: ${result.email}\nContraseña: ${result.tempPassword}`);
            showToast('success', 'Creado', 'Responsable creado correctamente');
        }

        closeModal('responsibleModal');
        loadResponsibles();
    } catch (error) {
        console.error(error);
        showToast('danger', 'Error', error.message);
    } finally {
        hideLoading();
    }
}

async function editResponsible(id) {
    showLoading();
    try {
        const { data: user, error } = await supabaseClient
            .from('profiles')
            .select('*')
            .eq('id', id)
            .single();
            
        if (error) throw error;

        document.getElementById('respId').value = user.id;
        document.getElementById('respEmail').value = user.email;
        document.getElementById('respEmail').disabled = true;
        document.getElementById('respName').value = user.full_name || '';
        document.getElementById('respStatus').value = user.status || 'active';
        document.getElementById('respRole').value = user.role || 'user';

        const modal = document.getElementById('responsibleModal');
        if (modal) modal.classList.add('active');
    } catch (error) {
        console.error(error);
        showToast('danger', 'Error', 'No se pudo cargar el responsable');
    } finally {
        hideLoading();
    }
}

async function deleteResponsible(id) {
    if (!confirm('¿Eliminar este responsable?')) return;
    showLoading();
    try {
        const session = await supabaseClient.auth.getSession();
        if (!session?.data?.session?.access_token) {
            throw new Error('No hay sesión activa');
        }

        const response = await fetch(`/admin/users/${id}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${session.data.session.access_token}`
            }
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || 'Error al eliminar responsable');
        }

        showToast('success', 'Eliminado', 'Responsable eliminado');
        loadResponsibles();
    } catch (error) {
        console.error(error);
        showToast('danger', 'Error', error.message);
    } finally {
        hideLoading();
    }
}

async function distributeWorkload() {
    if (!confirm('¿Redistribuir todas las tareas de usuarios no disponibles entre los usuarios activos?')) {
        return;
    }

    showLoading();
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (!session) throw new Error('No hay sesión activa');

        const response = await fetch('/admin/redistribute-tasks', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${session.access_token}`
            }
        });

        if (!response.ok) {
            throw new Error('Error en la redistribución');
        }

        const data = await response.json();
        showToast('success', 'Redistribución', data.message);
        
        // Recargar vista si estás en tareas o responsables
        if (currentSection === 'tasks') {
            loadTasks();
        } else if (currentSection === 'admin') {
            loadResponsibles();
        }
    } catch (error) {
        console.error('Error redistribuyendo tareas:', error);
        showToast('danger', 'Error', 'Error al redistribuir tareas: ' + error.message);
    } finally {
        hideLoading();
    }
}

async function openReassignTasksModal() {
    console.log('Abriendo modal de reasignación...');
    const fromSelect = document.getElementById('reassignFromUser');
    const toSelect = document.getElementById('reassignToUser');
    
    if (!fromSelect || !toSelect) return;
    
    showLoading();
    try {
        // Obtener usuarios para llenar los selectores
        const { data: users, error } = await supabaseClient
            .from('profiles')
            .select('*')
            .order('full_name');
            
        if (error) throw error;
        
        const optionsHtml = users.map(u => {
            const name = u.full_name || u.email;
            const statusLabel = u.status === 'active' ? '' : ` (${u.status})`;
            return `<option value="${name}">${name}${statusLabel}</option>`;
        }).join('');
        
        fromSelect.innerHTML = '<option value="">Seleccionar usuario origen...</option>' + optionsHtml;
        toSelect.innerHTML = '<option value="">Seleccionar usuario destino...</option>' + optionsHtml;
        
        const modal = document.getElementById('reassignTasksModal');
        if (modal) modal.classList.add('active');
        
    } catch (error) {
        console.error('Error loading users for reassignment:', error);
        showToast('danger', 'Error', 'No se pudieron cargar los usuarios.');
    } finally {
        hideLoading();
    }
}

async function executeReassignment() {
    const fromUser = document.getElementById('reassignFromUser').value;
    const toUser = document.getElementById('reassignToUser').value;
    
    if (!fromUser || !toUser) {
        showToast('warning', 'Datos incompletos', 'Seleccione ambos usuarios.');
        return;
    }
    
    if (fromUser === toUser) {
        showToast('warning', 'Error', 'El usuario de origen y destino no pueden ser el mismo.');
        return;
    }
    
    if (!confirm(`¿Está seguro de reasignar todas las tareas pendientes de "${fromUser}" a "${toUser}"?`)) return;
    
    showLoading();
    try {
        // Actualizar tareas pendientes
        const { error, count } = await supabaseClient
            .from('tareas')
            .update({ responsable: toUser })
            .eq('responsable', fromUser)
            .neq('estado', 'Completada')
            .neq('estado', 'Recobrado')
            .neq('estado', 'Rehusado NO cobertura')
            .neq('estado', 'Archivado')
            .neq('estado', 'Datos NO válidos'); // Opcional: incluir o excluir según lógica de negocio
            
        if (error) throw error;
        
        showToast('success', 'Reasignación completada', `Las tareas han sido transferidas correctamente.`);
        closeModal('reassignTasksModal');
        
        // Recargar si estamos en una vista relevante
        const currentSection = document.querySelector('.content-section.active')?.id;
        if (currentSection === 'admin') loadResponsibles();
        if (currentSection === 'workload') loadWorkloadStats();
        
    } catch (error) {
        console.error('Error reassigning tasks:', error);
        showToast('danger', 'Error', 'Error al reasignar tareas: ' + error.message);
    } finally {
        hideLoading();
    }
}

async function loadWorkloadStats() {
    console.log('Cargando estadísticas de carga...');
    const tableBody = document.getElementById('workloadTable');
    if (!tableBody) return;

    showLoading();
    try {
        // Usuarios activos
        const { data: users, error: uError } = await supabaseClient
            .from('profiles')
            .select('*')
            .eq('status', 'active');
        if (uError) throw uError;

        // Tareas
        const { data: tasks, error: tError } = await supabaseClient
            .from('tareas')
            .select('responsable, estado');
        if (tError) throw tError;

        // Calcular stats
        const stats = {};
        users.forEach(u => {
            const name = u.full_name || u.email;
            stats[name] = { user: u, active: 0, completed: 0 };
        });

        tasks.forEach(t => {
            if (t.responsable && stats[t.responsable]) {
                const isCompleted = ['Completada', 'Recobrado', 'Rehusado NO cobertura'].includes(t.estado);
                if (isCompleted) {
                    stats[t.responsable].completed++;
                } else {
                    stats[t.responsable].active++;
                }
            }
        });

        // Renderizar
        tableBody.innerHTML = '';
        Object.values(stats).forEach(stat => {
            // Calcular porcentaje relativo a un máximo arbitrario (ej. 20 tareas) o relativo al total
            const maxLoadReference = 20; 
            const percent = Math.min(100, (stat.active / maxLoadReference) * 100);
            
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${stat.user.full_name || stat.user.email}</td>
                <td><span class="status-badge status-available">Activo</span></td>
                <td>${stat.active}</td>
                <td>${stat.completed}</td>
                <td>
                    <div class="progress" style="height: 6px;">
                        <div class="progress-bar bg-info" role="progressbar" style="width: ${percent}%"></div>
                    </div>
                </td>
                <td><span class="badge bg-success">Disponible</span></td>
            `;
            tableBody.appendChild(row);
        });

    } catch (error) {
        console.error(error);
        tableBody.innerHTML = '<tr><td colspan="6" class="text-center text-danger">Error al cargar datos</td></tr>';
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

        const { count: taskCount } = await supabaseClient.from('tareas').select('*', { count: 'exact', head: true }).neq('estado', 'Completada');
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

function resetLimits() {
    if (!confirm('¿Restablecer los límites a los valores predeterminados?')) return;

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
        const worksheet = XLSX.utils.json_to_sheet(reportData);
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
        const { data: archives, count, error } = await supabaseClient
            .from('expedientes')
            .select('*', { count: 'exact' })
            .eq('estado', 'Archivado')
            .order('fecha_ocurrencia', { ascending: false })
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
    if (!confirm(`¿Está seguro de que desea restaurar este expediente? Pasará a estado "Pendiente".`)) return;
    
    showLoading();
    try {
        const { error } = await supabaseClient
            .from('expedientes')
            .update({ estado: 'Pendiente' })
            .eq('id', id);

        if (error) throw error;

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

function resetConfig() {
    if (!confirm('¿Restablecer la configuración general a los valores predeterminados?')) return;

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

function previewImport() {
    console.log('Función previewImport llamada');
    showToast('info', 'En desarrollo', 'La vista previa de importación estará disponible próximamente.');
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
        const data = await parsearArchivoImportacion(file, file.name);
        
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
        
        const resultado = await insertarExpedientesEnSupabase(expedientesParaInsertar);

        // Verificar referencia generada (si la DB tiene trigger/columna generada)
        if (resultado.expedientes && resultado.expedientes.length > 0) {
            console.log('Referencia Gescon generada (ejemplo):', resultado.expedientes[0].referencia_gescon);
        }

        // REGISTRAR IMPORTACIÓN (LOG)
        await saveImportLog({
            fileName: file.name,
            totalRecords: data.length,
            duplicates: duplicadosEncontrados.length,
            status: 'Completado'
        });

        // PASO 4: Distribuir Tareas si está activado
        // REACTIVADO para cumplir con la lógica de "Pdte. revisión" y asignación equitativa específica
        if (distribuirTareas && resultado.expedientes && resultado.expedientes.length > 0) {
           await distribuirTareasImportadas(resultado.expedientes, distribuirEquitativamente);
        }

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

// Función auxiliar para distribuir tareas tras importación
async function distribuirTareasImportadas(expedientes, distribuirEquitativamente) {
    try {
        showToast('info', 'Generando Tareas', 'Verificando y creando tareas para los expedientes importados...');
        
        // 1. Verificar tareas existentes para evitar duplicados
        const siniestros = expedientes.map(e => e.num_siniestro).filter(n => n);
        
        if (siniestros.length > 0) {
            const { data: tareasExistentes, error: checkError } = await supabaseClient
                .from('tareas')
                .select('num_siniestro') // FIX: Verificar por num_siniestro para evitar duplicados fantasma
                .in('num_siniestro', siniestros);

            if (checkError) throw checkError;

            const siniestrosConTarea = new Set(tareasExistentes.map(t => t.num_siniestro));
            // Filtrar expedientes que ya tienen tarea
            expedientes = expedientes.filter(exp => !siniestrosConTarea.has(exp.num_siniestro));
        }

        if (expedientes.length === 0) {
            showToast('info', 'Tareas Actualizadas', 'Todos los expedientes importados ya tienen tareas asignadas.');
            return;
        }

        let responsables = [];
        if (distribuirEquitativamente) {
            // Intentar obtener usuarios activos
            const { data: users } = await supabaseClient
                .from('profiles')
                .select('*')
                .eq('status', 'active');
            responsables = users || [];
        }

        // Fallback a datos locales si no hay usuarios en DB o error
        if (responsables.length === 0 && typeof responsiblesData !== 'undefined') {
            responsables = responsiblesData.filter(r => r.status === 'available' || r.status === 'active');
        }

        const tareas = expedientes.map((exp, index) => {
            let responsable = '';
            if (responsables.length > 0) {
                const user = responsables[index % responsables.length];
                responsable = user.full_name || user.name || user.email;
            }

            return {
                num_siniestro: exp.num_siniestro,
                // referencia_gescon: exp.referencia_gescon, // Pasar referencia (Desactivado por error de esquema)
                responsable: responsable,
                descripcion: `Gestión inicial del expediente ${exp.num_siniestro} (Importado)`,
                // REQ: Prioridad Alta si importe > 1500 o fecha limite es hoy.
                // REQ: Fecha límite inicial es HOY (día de carga).
                prioridad: (exp.importe > 1500) ? 'Alta' : 'Media', 
                fecha_limite: new Date().toISOString().split('T')[0], // REQ: Mismo día de carga
                estado: 'Pdte. revisión' // Estado inicial requerido
            };
        });

        const { error } = await supabaseClient.from('tareas').insert(tareas);
        if (error) throw error;
        
        showToast('success', 'Tareas Generadas', `Se han creado ${tareas.length} tareas automáticamente.`);
    } catch (error) {
        console.error('Error distribuyendo tareas:', error);
        // No bloqueamos el flujo principal, solo avisamos
        showToast('warning', 'Aviso Tareas', 'Expedientes importados, pero error al crear tareas: ' + (error.message || 'Tabla tareas no existe'));
    }
}

// ============================================================================
// GESTIÓN DE REGISTRO DE IMPORTACIONES (LOGS)
// ============================================================================

async function saveImportLog(logData) {
    try {
        const { error } = await supabaseClient
            .from('import_logs')
            .insert([{
                file_name: logData.fileName,
                total_records: logData.totalRecords,
                duplicates_count: logData.duplicates,
                status: logData.status,
                created_at: new Date().toISOString()
            }]);
            
        if (error) {
            console.log('Log de importación no guardado en DB (tabla no existe o error).');
        }
    } catch (e) {
        // console.error('Error saving import log:', e);
    }
}

async function loadImportLogs() {
    const tableBody = document.getElementById('importLogTable');
    if (!tableBody) return;

    try {
        const { data: logs, error } = await supabaseClient
            .from('import_logs')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(20);

        if (error) throw error;

        tableBody.innerHTML = '';
        if (!logs || logs.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No hay registros de importación recientes.</td></tr>';
            return;
        }

        logs.forEach(log => {
            const row = document.createElement('tr');
            const date = new Date(log.created_at).toLocaleString();
            
            // Determinar si hay incidencias para habilitar el botón de detalles
            const hasIssues = (log.duplicates_count > 0) || (log.status === 'Error');
            
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
        console.warn('Error loading import logs (Tabla import_logs podría no existir):', error);
        // No mostramos error al usuario para no ensuciar la UI si la tabla no existe aún
    }
}

function downloadImportFile(id, fileName) {
    // Nota: Para que esto funcione realmente, se debe implementar la subida del archivo a Supabase Storage al importar
    console.log(`Solicitando descarga de archivo: ${fileName} (Log ID: ${id})`);
    showToast('info', 'Descarga no disponible', 'El archivo original no está almacenado. Se requiere configurar Supabase Storage.');
}

function viewImportErrors(id) {
    // Nota: Esto requeriría guardar un JSON de errores en la tabla import_logs
    console.log(`Solicitando detalles de errores para Log ID: ${id}`);
    showToast('info', 'Detalles', 'Visualización de detalles de error en desarrollo.');
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
                .from('tareas')
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
            supabaseClient.functions.invoke('send-email', {
                body: { to: adminEmail, subject, html }
            }).catch(err => console.error('Error enviando aviso duplicados:', err));
        }
        
        return { nuevos, duplicados };
    } catch (error) {
        console.error('Error verificando duplicados:', error);
        // En caso de error, devolver todos como nuevos para no bloquear la importación
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
async function insertarExpedientesEnSupabase(expedientes) {
    try {
        const { data, error } = await supabaseClient
            .from('expedientes')
            .insert(expedientes)
            .select();

        if (error) throw error;

        return {
            insertados: data.length,
            expedientes: data
        };
    } catch (error) {
        throw new Error('Error al insertar en base de datos: ' + error.message);
    }
}

function openDatePicker(element, id) {
    console.log('Función openDatePicker llamada para:', id);
    showToast('info', 'En desarrollo', 'El selector de fecha estará disponible próximamente.');
}

// ============================================================================
// SUPABASE REALTIME - NOTIFICACIONES
// ============================================================================

function setupRealtimeSubscription() {
    if (!currentUser || realtimeSubscription) return;

    console.log('Configurando suscripción Realtime para:', currentUser.name);

    realtimeSubscription = supabaseClient
        .channel('public:tareas')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'tareas' }, payload => {
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
        // Get expedientes statistics
        const { data: expedientes, error: expError } = await supabaseClient
            .from('expedientes')
            .select('estado', { count: 'exact' });
        
        if (expError) throw expError;
        
        // Count by status
        const totalExpedientes = expedientes ? expedientes.length : 0;
        const pendientes = expedientes ? expedientes.filter(e => e.estado === 'Pdte. revisión' || e.estado === 'Pendiente').length : 0;
        const enProceso = expedientes ? expedientes.filter(e => e.estado === 'En Proceso' || e.estado === 'En gestión').length : 0;
        
        // Get today's urgent tasks
        const today = new Date().toISOString().split('T')[0];
        const { data: urgentTasks, error: urgError } = await supabaseClient
            .from('expedientes')
            .select('*', { count: 'exact' })
            .lte('fecha_seguimiento', today)
            .neq('estado', 'Completado')
            .neq('estado', 'Archivado');
        
        const vencimientoHoy = urgentTasks ? urgentTasks.length : 0;
        
        // Update dashboard cards
        const cards = document.querySelectorAll('#dashboard .card h2');
        if (cards.length >= 4) {
            cards[0].textContent = totalExpedientes;
            cards[1].textContent = pendientes;
            cards[2].textContent = enProceso;
            cards[3].textContent = vencimientoHoy;
        }
        
        console.log('Dashboard stats loaded:', { totalExpedientes, pendientes, enProceso, vencimientoHoy });
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
        await Promise.all([
            renderMonthlyChart(),
            renderStatusChart()
        ]);
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
            // 1. Enviar Resumen de Tareas por Gestor
            await enviarResumenTareasPorGestor();
            
            // 2. Archivar Finalizados
            await archivarFinalizados();
            
            // 3. Redistribuir carga de usuarios ausentes (NUEVO)
            const { data: { session } } = await supabaseClient.auth.getSession();
            if (session) {
                const response = await fetch('/admin/redistribute-tasks', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${session.access_token}` }
                });
                if (response.ok) {
                    const resData = await response.json();
                    console.log('Redistribución automática:', resData);
                    if (resData.redistributed > 0) {
                        showToast('info', 'Automatización', `${resData.redistributed} tareas redistribuidas.`);
                    }
                }
            }
            
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
            .from('tareas')
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

        // 3. Enviar correos (Iterar responsables)
        let emailsSent = 0;
        
        for (const [responsable, userTasks] of Object.entries(tasksByResponsible)) {
            // Intentar resolver email si 'responsable' es un nombre
            let email = responsable;
            
            // Si no parece un email, buscar en datos locales
            if (!email.includes('@')) {
                const respObj = responsiblesData.find(r => r.name === responsable);
                if (respObj) email = respObj.email;
                else if (typeof usersData !== 'undefined') {
                    const userObj = usersData.find(u => u.full_name === responsable);
                    if (userObj) email = userObj.email;
                }
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

                // Llamar a Edge Function
                const { error: funcError } = await supabaseClient.functions.invoke('send-email', {
                    body: { to: email, subject: `📝 Tus Tareas Pendientes - ${new Date().toLocaleDateString()}`, html: htmlBody }
                });

                if (funcError) console.error(`Error enviando a ${email}:`, funcError);
                else emailsSent++;
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
    
    // Buscar tareas finalizadas o finalizadas parciales
    const { data: finishedTasks, error } = await supabaseClient
        .from('tareas')
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
            .from('tareas')
            .update({ estado: 'Archivado' })
            .in('id', ids);
            
        if (!updateError) {
            console.log(`${ids.length} tareas movidas a archivo.`);
        }
    }
}

async function renderMonthlyChart() {
    const canvas = document.getElementById('monthlyChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    // Obtener datos de expedientes
    const { data: expedientes, error } = await supabaseClient
        .from('expedientes')
        .select('fecha_ocurrencia');

    if (error) throw error;

    // Procesar datos por mes (YYYY-MM)
    const stats = {};
    expedientes.forEach(exp => {
        const dateStr = exp.fecha_ocurrencia || exp.created_at;
        if (!dateStr) return;
        
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) return;
        
        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        stats[key] = (stats[key] || 0) + 1;
    });

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

async function renderStatusChart() {
    const canvas = document.getElementById('statusChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const { data: expedientes, error } = await supabaseClient.from('expedientes').select('estado');
    if (error) throw error;

    const stats = {};
    expedientes.forEach(exp => {
        const status = exp.estado || 'Sin estado';
        stats[status] = (stats[status] || 0) + 1;
    });

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
            .from('tareas')
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
                           
        if (!confirm(confirmMsg)) return;
        
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
    if (!confirm('PELIGRO: ¿Estás seguro de que quieres BORRAR TODOS los expedientes, tareas y duplicados?\n\nEsta acción no se puede deshacer.')) return;
    if (!confirm('Confirmación final: Se borrarán TODOS los datos para empezar de cero.')) return;
    
    showLoading();
    try {
        await supabaseClient.from('tareas').delete().neq('id', 0); // Borrar todas las tareas
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
        <div class="text-muted small">
            Mostrando ${startItem}-${endItem} de ${totalTasks} tareas
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

function searchTasks() {
    currentTaskPage = 1;
    loadTasks();
}
