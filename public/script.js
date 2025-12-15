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
            // Verificar si es admin consultando al servidor
            const token = session.access_token;
            let isAdmin = false;
            try {
                const adminCheck = await fetch('/admin/check', {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (adminCheck.ok) {
                    const adminData = await adminCheck.json();
                    isAdmin = adminData.isAdmin;
                }
            } catch (e) {
                console.warn('Could not verify admin status', e);
            }

            currentUser = {
                email: session.user.email,
                name: session.user.email.split('@')[0],
                id: session.user.id,
                isAdmin: isAdmin
            };
            showApp();
            await             initializeApp();
                        
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
    document.getElementById('authContainer').classList.remove('d-none');
    document.getElementById('appContainer').classList.add('d-none');
}

function showApp() {
    console.log('Showing app container');
    const authContainer = document.getElementById('authContainer');
    const appContainer = document.getElementById('appContainer');
    const loadingOverlay = document.getElementById('loadingOverlay');

    // Force hide/show using inline styles (stronger than classes)
    authContainer.classList.add('d-none');
    authContainer.style.display = 'none'; // Inline override

    appContainer.classList.remove('d-none');
    appContainer.style.display = 'block'; // Inline override

    // Force hide loading overlay
    loadingOverlay.classList.remove('show');
    loadingOverlay.style.display = 'none'; // Inline override

    // DEBUG: Verificar si realmente se mostró
    console.log('Auth classes:', authContainer.className);
    console.log('App classes:', appContainer.className);
    console.log('App style display:', window.getComputedStyle(appContainer).display);

    // Check if external CSS is loaded
    const isCssLoaded = Array.from(document.styleSheets).some(s => s.href && s.href.includes('style.css'));
    console.log('style.css loaded:', isCssLoaded);

    // CRITICAL FIX: Inject fallback styles in case CSS failed or is overridden
    const fallbackStyle = document.createElement('style');
    fallbackStyle.innerHTML = `
        #appContainer { display: block !important; width: 100vw !important; height: 100vh !important; overflow: auto !important; }
        .sidebar { width: 250px !important; height: 100vh !important; display: block !important; position: fixed !important; z-index: 1000 !important; background: #2c3e50; color: white; }
        .main-content { margin-left: 250px !important; width: calc(100vw - 250px) !important; display: block !important; height: 100% !important; }
        #dashboard { display: block !important; width: 100% !important; }
    `;
    document.head.appendChild(fallbackStyle);
    console.log('Injected fallback CSS for layout safety');

    // DEBUG: Layout check
    const sidebar = document.querySelector('.sidebar');
    const main = document.querySelector('.main-content');
    const dashboard = document.getElementById('dashboard');

    // Log appContainer specifically
    const appContainerRect = appContainer.getBoundingClientRect();
    console.log('AppContainer dimensions:', appContainerRect.width, 'x', appContainerRect.height);
    console.log('Window dimensions:', window.innerWidth, 'x', window.innerHeight);

    console.log('Sidebar dimensions:', sidebar ? sidebar.getBoundingClientRect() : 'MISSING');
    console.log('Main dimensions:', main ? main.getBoundingClientRect() : 'MISSING');
    console.log('Dashboard dimensions:', dashboard ? dashboard.getBoundingClientRect() : 'MISSING');
    console.log('Dashboard classes:', dashboard ? dashboard.className : 'MISSING');
    console.log('Dashboard display:', dashboard ? window.getComputedStyle(dashboard).display : 'MISSING');

    // Forzar visibilidad de los hijos clave por si el CSS falla
    if (sidebar) {
        sidebar.classList.add('active');
        sidebar.style.display = 'block';
        sidebar.style.width = '250px';
        // sidebar.style.border = '5px solid blue'; // Removing disruptive debug border
        sidebar.style.zIndex = '9999';
        sidebar.style.opacity = '1';
        sidebar.style.visibility = 'visible';
    }

    if (main) {
        main.style.display = 'block';
        main.style.marginLeft = '250px';
        // main.style.border = '5px solid green'; // Removing disruptive debug border
        main.style.minHeight = '100vh'; // Ensure it takes height
        main.style.zIndex = '1';
        main.style.opacity = '1';
        main.style.visibility = 'visible';


        // DEBUG: Texto de confirmación (menos intrusivo)
        console.log('Main content configured');
    }

    // DEBUG: Verificar si el appContainer tiene contenido HTML real
    console.log('AppContainer Children count:', appContainer.children.length);
    console.log('AppContainer First Child:', appContainer.firstElementChild);

    hideLoading();
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
            // Verificar admin tras login
            const token = data.session.access_token;
            let isAdmin = false;
            try {
                const adminCheck = await fetch('/admin/check', {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (adminCheck.ok) {
                    const adminData = await adminCheck.json();
                    isAdmin = adminData.isAdmin;
                }
            } catch (e) {
                console.warn('Could not verify admin status', e);
            }

            currentUser = {
                email: data.user.email,
                name: data.user.email.split('@')[0],
                id: data.user.id,
                isAdmin: isAdmin
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

// Función registerFirstUser eliminada por razones de seguridad (duplicada e insegura).
// Use la versión segura définie arriba o cree usuarios admin mediante el backend.

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
    console.log('Función importarExpedientes llamada');    console.log('Función importarExpedientes llamada');
    
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
        const data = await parsearArchivoImportacion(file);
        
        if (!data || data.length === 0) {
            showToast('warning', 'Archivo vacío', 'El archivo no contiene datos válidos.');
            hideLoading();
            return;
        }

        // Obtener opciones de importación
        const verificarDuplicados = document.getElementById('verificarDuplicados')?.checked ?? true;
        const normalizarCampos = document.getElementById('normalizarCampos')?.checked ?? true;
        const distribuirTareas = document.getElementById('distribuirTareas')?.checked ?? true;
        const distribuirEquitativamente = document.getElementById('distribuirEquitativamente')?.checked ?? true;
        
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
            }
        }
        
        // PASO 3: Insertar en Supabase
        if (expedientesParaInsertar.length === 0) {
            hideLoading();
            showToast('warning', 'Sin nuevos expedientes', 'Todos los expedientes ya existían en el sistema.');
            return;
        }
        
        const resultado = await insertarExpedientesEnSupabase(expedientesParaInsertar);
        hideLoading();
        showToast('success', 'Importación Completada', 
            `Se importaron ${resultado.insertados} expedientes correctamente.`);
        
        // Recargar dashboard stats
        await loadDashboardStats();

    } catch (error) {
        console.error('Error importando expedientes:', error);
        hideLoading();
        showToast('danger', 'Error', 'Error al importar expedientes: ' + error.message);


        // ============================================================================
// FUNCIONES AUXILIARES PARA IMPORTACIÓN DE EXPEDIENTES - FASE 2a
// ============================================================================


        // Función para verificar y eliminar duplicados por nº de siniestro
async function verificarYEliminarDuplicados(expedientes) {
    try {
        // Obtener todos los números de siniestro del archivo
        const numerosSiniestro = expedientes.map(exp => exp.num_siniestro).filter(num => num && num.trim() !== '');
        
        if (numerosSiniestro.length === 0) {
            return { nuevos: expedientes, duplicados: [] };
        }
        
        // Consultar en Supabase qué números de siniestro ya existen
        const { data: existentes, error } = await supabaseClient
            .from('expedientes')
            .select('num_siniestro')
            .in('num_siniestro', numerosSiniestro);
        
        if (error) throw error;
        
        // Crear un Set con los números de siniestro que ya existen
        const siniestrosExistentes = new Set(existentes.map(exp => exp.num_siniestro));
        
        // Separar expedientes nuevos de duplicados
        const nuevos = [];
        const duplicados = [];
        
        expedientes.forEach(exp => {
            if (exp.num_siniestro && siniestrosExistentes.has(exp.num_siniestro)) {
                duplicados.push(exp);
            } else {
                nuevos.push(exp);
            }
        });
        
        return { nuevos, duplicados };
    } catch (error) {
        console.error('Error verificando duplicados:', error);
        // En caso de error, devolver todos como nuevos para no bloquear la importación
        return { nuevos: expedientes, duplicados: [] };
    }
}

// Función auxiliar para parsear archivo CSV/Excel con SheetJS
async function parsearArchivoImportacion(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = function(e) {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                
                // Obtener la primera hoja
                const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                
                // Convertir a JSON
                const jsonData = XLSX.utils.sheet_to_json(firstSheet);
                
                // Normalizar y mapear campos
                const expedientesNormalizados = jsonData.map(row => normalizarExpediente(row));
                
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
function normalizarExpediente(row) {
    return {
        num_siniestro: row['Nº Siniestro'] || row['num_siniestro'] || row['NUM_SINIESTRO'] || '',
        num_poliza: row['Nº Póliza'] || row['num_poliza'] || row['NUM_POLIZA'] || '',
        num_sgr: row['Nº SGR'] || row['num_sgr'] || row['NUM_SGR'] || '',
        nombre_asegurado: row['Asegurado'] || row['nombre_asegurado'] || row['NOMBRE'] || '',
        direccion_asegurado: row['Dirección'] || row['direccion'] || row['DIRECCION'] || '',
        cp: row['CP'] || row['codigo_postal'] || '',
        importe: parseFloat(row['Importe'] || row['importe'] || 0),
        fecha_ocurrencia: row['Fecha Ocurrencia'] || row['fecha_ocurrencia'] || null,
        tipo_dano: row['Tipo Daño'] || row['tipo_dano'] || row['TIPO_DAÑO'] || '',
        nombre_causante: row['Causante'] || row['nombre_causante'] || '',
        direccion_causante: row['Dirección Causante'] || row['direccion_causante'] || '',
        cia_causante: row['Cía Causante'] || row['cia_causante'] || '',
        estado: 'Pdte. revisión', // Estado inicial
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
// CONTROL DE ACCESO Y ROLES (ROLE-BASED ACCESS CONTROL - RBAC)
// ============================================================================

// Constantes
const ADMIN_EMAIL = 'jesus.mp@gescon360.es';
const ADMIN_ROLE = 'admin';
const USER_ROLE = 'user';

// Verificar si usuario actual es admin
// Verificar si usuario actual es admin
function isCurrentUserAdmin() {
    if (!currentUser) return false;
    return currentUser.isAdmin === true;
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
        
// ============================================================================
// FUNCIONES CLIENTE PARA GESTIÓN DE ROLES DE ADMINISTRADOR
// ============================================================================

// URL del servidor backend (ajusta según tu despliegue)
// URL del servidor backend (ajusta según tu despliegue)
const ADMIN_API_URL = ''; // Ruta relativa para producción (mismo dominio)

/**
 * Cambiar rol de administrador de un usuario
 * @param {string} targetUserId - ID del usuario a modificar
 * @param {boolean} makeAdmin - true para promover, false para revocar
 * @returns {Promise<Object>} Resultado de la operación
 */
async function setAdminRole(targetUserId, makeAdmin) {
    try {
        // Obtener el access token del usuario actual
        const { data: { session } } = await supabaseClient.auth.getSession();

        if (!session) {
            throw new Error('No hay sesión activa');
        }

        const accessToken = session.access_token;

        // Llamar al endpoint server-side
        const response = await fetch(`${ADMIN_API_URL}/admin/set-admin`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`
            },
            body: JSON.stringify({
                targetUserId,
                makeAdmin
            })
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || 'Error al cambiar rol');
        }

        console.log('✓ Rol actualizado:', result);
        return result;

    } catch (error) {
        console.error('Error cambiando rol de administrador:', error);
        throw error;
    }
}

/**
 * Verificar si el usuario actual es administrador
 * @returns {Promise<boolean>} true si es admin, false si no
 */
async function checkIfCurrentUserIsAdmin() {
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();

        if (!session) {
            return false;
        }

        const response = await fetch(`${ADMIN_API_URL}/admin/check`, {
            headers: {
                'Authorization': `Bearer ${session.access_token}`
            }
        });

        const result = await response.json();
        return result.isAdmin === true;

    } catch (error) {
        console.error('Error verificando rol de administrador:', error);
        return false;
    }
}

/**
 * Ejemplo de uso en UI: botón para promover/revocar admin
 */
async function handleAdminButtonClick(userId, currentlyAdmin) {
    try {
        const action = currentlyAdmin ? 'revocar' : 'promover';

        if (!confirm(`¿Estás seguro de ${action} permisos de administrador para este usuario?`)) {
            return;
        }

        const result = await setAdminRole(userId, !currentlyAdmin);

        showToast('success', 'Éxito', result.message);

        // Recargar lista de usuarios o actualizar UI
        // loadSecurityTable(); // Descomentar para refrescar la tabla

    } catch (error) {
        showToast('danger', 'Error', error.message);
    }
}

/**
 * Inicialización: verificar si usuario actual es admin al cargar la página
 */
async function initializeAdminUI() {
    const isAdmin = await checkIfCurrentUserIsAdmin();

    if (isAdmin) {
        console.log('✓ Usuario actual tiene permisos de administrador');
        // Mostrar elementos de UI de administración
        document.querySelectorAll('.admin-only').forEach(el => {
            el.style.display = 'block';
        });
    } else {
        console.log('Usuario actual NO es administrador');
        // Ocultar elementos de UI de administración
        document.querySelectorAll('.admin-only').forEach(el => {
            el.style.display = 'none';
        });
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
}
