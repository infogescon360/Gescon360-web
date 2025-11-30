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
const SUPABASE_URL = 'https://bytvzgxcemhlnuggwqno.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_pikHbbQBbW9LLQcf3drog_BQ2reqkF';

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
    document.getElementById('loginAlert').style.display = 'flex';

    /* Código original de Apps Script (a reemplazar):
    google.script.run.withSuccessHandler(function(hasUsers) {
        console.log(`Users check result: ${hasUsers}`);
        
        if (!hasUsers) {
            document.getElementById('loginAlert').style.display = 'flex';
        }
    }).withFailureHandler(function(error) {
        handleGASError(error, 'verificación de usuarios');
        document.getElementById('loginAlert').style.display = 'flex';
    }).hasUsers();
    */
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
            showToast('success', 'Bienvenido', 'Has iniciado sesión correctamente');
        }
    } catch (error) {
        console.error('Login error:', error);
        loginButtonText.classList.remove('d-none');
        loginSpinner.classList.add('d-none');
        loginButton.disabled = false;
        showToast('danger', 'Error de autenticación', error.message || 'Correo o contraseña incorrectos');
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
// Initialize Application
function initializeApp() {
    console.log('Initializing application');
    
    try {
        // Update user info
        if (currentUser) {
            document.getElementById('userName').textContent = currentUser.name;
        }
        
        // Load data from Google Apps Script with proper error handling
        loadExpedientes();
        loadUsers();
        loadTasks();
        loadResponsibles();
        loadDuplicates();
        checkUrgentTasks();
        loadSystemLimits();
        
        // Initialize charts after a short delay to ensure DOM is ready
        setTimeout(initializeCharts, 500);
        
        console.log('Application initialized successfully');
    } catch (error) {
        console.error(`Error initializing application: ${error.message}`);
        showToast('danger', 'Error de inicialización', 'No se pudo inicializar la aplicación: ' + error.message);
    }
}

// Navigation Functions - VERSIÓN CORREGIDA
function showSection(sectionId) {
    console.log(`Showing section: ${sectionId}`);
    
    // Prevenir comportamiento por defecto
    if (event) {
        event.preventDefault();
    }
    
    // Check admin access for admin sections
    if ((sectionId === 'admin' || sectionId === 'workload' || sectionId === 'limits' || sectionId === 'users') && !checkAdminAccess()) {
        showToast('danger', 'Acceso denegado', 'No tiene permisos de administrador para acceder a esta sección');
        return;
    }
    
    // Hide all sections
    document.querySelectorAll('.content-section').forEach(section => {
        section.style.display = 'none';
        section.classList.remove('active');
    });
    
    // Show selected section
    const selectedSection = document.getElementById(sectionId);
    if (selectedSection) {
        selectedSection.style.display = 'block';
        selectedSection.classList.add('active');
    } else {
        console.error(`Section ${sectionId} not found!`);
        showToast('danger', 'Error', `Sección ${sectionId} no encontrada`);
        return;
    }
    
    // Update active menu item
    document.querySelectorAll('.sidebar-menu a').forEach(link => {
        link.classList.remove('active');
    });
    
    // Find and activate the correct menu item
    const activeLink = document.querySelector(`[onclick="showSection('${sectionId}')"]`);
    if (activeLink) {
        activeLink.classList.add('active');
    }
    
    // Update page title
    const titles = {
        'dashboard': 'Dashboard',
        'import': 'Importar Expedientes',
        'tasks': 'Gestión de Tareas',
        'duplicates': 'Expedientes Duplicados',
        'admin': 'Gestión de Responsables',
        'workload': 'Distribución de Carga',
        'reports': 'Reportes',
        'archive': 'Archivados',
        'config': 'Configuración',
        'limits': 'Límites del Sistema',
        'users': 'Gestión de Usuarios'
    };
    
    const pageTitleElement = document.getElementById('pageTitle');
    if (pageTitleElement) {
        pageTitleElement.textContent = titles[sectionId] || 'Dashboard';
    }
    
    currentSection = sectionId;
    
    // Load section-specific data con manejo de errores
    try {
        if (sectionId === 'users') {
            loadUsersTable();
        } else if (sectionId === 'tasks') {
            loadTasksTable();
        } else if (sectionId === 'admin') {
            displayResponsibles();
        } else if (sectionId === 'workload') {
            loadWorkloadData();
        } else if (sectionId === 'duplicates') {
            loadDuplicatesTable();
        } else if (sectionId === 'limits') {
            loadSystemLimits();
        } else if (sectionId === 'reports') {
            setTimeout(initializeCharts, 100);
        }
    } catch (error) {
        console.error(`Error loading section data: ${error.message}`);
        showToast('warning', 'Advertencia', 'Algunos datos no pudieron cargarse');
    }
}

function checkAdminAccess() {
    // Por ahora, simulamos que el usuario siempre es admin.
    // Esto se conectará a la lógica real más adelante.
    return true; 
}

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.toggle('active');
}

// ... (El resto de tus funciones de JavaScript original van aquí) ...
// Para no hacer el mensaje infinitamente largo, he incluido las más importantes.
// DEBES PEGAR EL RESTO DE TUS FUNCIONES DESDE TU AI.html ORIGINAL AQUÍ.
// Por ejemplo: searchExpedients, clearSearch, loadTasksTable, etc.

// Initialize charts
function initializeCharts() {
    console.log('Initializing charts...');
    
    try {
        // Monthly chart
        const monthlyCtx = document.getElementById('monthlyChart');
        if (monthlyCtx) {
            new Chart(monthlyCtx, {
                type: 'bar',
                data: {
                    labels: ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio'],
                    datasets: [{
                        label: 'Expedientes Procesados',
                        data: [65, 59, 80, 81, 56, 55],
                        backgroundColor: 'rgba(52, 152, 219, 0.2)',
                        borderColor: 'rgba(52, 152, 219, 1)',
                        borderWidth: 1
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false
                }
            });
        }
        
        // Status chart
        const statusCtx = document.getElementById('statusChart');
        if (statusCtx) {
            new Chart(statusCtx, {
                type: 'doughnut',
                data: {
                    labels: ['Pendientes', 'En Proceso', 'Completados', 'Archivados'],
                    datasets: [{
                        data: [30, 25, 35, 10],
                        backgroundColor: [
                            'rgba(243, 156, 18, 0.2)',
                            'rgba(52, 152, 219, 0.2)',
                            'rgba(39, 174, 96, 0.2)',
                            'rgba(52, 73, 94, 0.2)'
                        ],
                        borderColor: [
                            'rgba(243, 156, 18, 1)',
                            'rgba(52, 152, 219, 1)',
                            'rgba(39, 174, 96, 1)',
                            'rgba(52, 73, 94, 1)'
                        ],
                        borderWidth: 1
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false
                }
            });
        }
        
        console.log('Charts initialized successfully');
    } catch (error) {
        console.error(`Error initializing charts: ${error.message}`);
    }
}

// Modal functions
function openDatePicker(element, expedientId) {
    selectedDateElement = element;
    selectedDateId = expedientId;
    selectedDateValue = element.textContent.trim();
    
    // Create date picker modal if it doesn't exist
    let datePickerModal = document.getElementById('datePickerModal');
    if (!datePickerModal) {
        datePickerModal = document.createElement('div');
        datePickerModal.id = 'datePickerModal';
        datePickerModal.className = 'modal-overlay';
        datePickerModal.innerHTML = `
            <div class="modal-content" style="max-width: 400px;">
                <div class="modal-header">
                    <h5 class="modal-title">Seleccionar Fecha</h5>
                    <button class="modal-close" onclick="closeDatePicker()">
                        <i class="bi bi-x"></i>
                    </button>
                </div>
                <div class="modal-body">
                    <input type="date" class="form-control" id="datePickerInput">
                </div>
                <div class="modal-footer">
                    <button class="btn-custom btn-outline-custom" onclick="closeDatePicker()">Cancelar</button>
                    <button class="btn-custom btn-primary-custom" onclick="saveDate()">Guardar</button>
                </div>
            </div>
        `;
        document.body.appendChild(datePickerModal);
    }
    
    // Set current date
    const datePickerInput = document.getElementById('datePickerInput');
    const currentDate = new Date(selectedDateValue.replace(/.*(\d{2})\/(\d{2})\/(\d{4}).*/, '$3-$2-$1'));
    datePickerInput.value = currentDate.toISOString().split('T')[0];
    
    // Show modal
    datePickerModal.classList.add('active');
}

function closeDatePicker() {
    const datePickerModal = document.getElementById('datePickerModal');
    if (datePickerModal) {
        datePickerModal.classList.remove('active');
    }
}

function saveDate() {
    const datePickerInput = document.getElementById('datePickerInput');
    const newDate = datePickerInput.value;
    
    if (!newDate) {
        showToast('warning', 'Fecha requerida', 'Por favor, seleccione una fecha');
        return;
    }
    
    console.log(`Updating due date for expediente ${selectedDateId} to ${newDate}`);
    
    // ESTA FUNCIÓN DEBERÁ SER REEMPLAZADA
    showToast('success', 'Fecha actualizada', 'La fecha se ha actualizado correctamente (simulado).');
    
    // Update UI
    const date = new Date(newDate);
    const formattedDate = `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
    selectedDateElement.innerHTML = `<i class="bi bi-calendar-event"></i>${formattedDate}`;
    
    closeDatePicker();
    
    /* Código original de Apps Script (a reemplazar):
    google.script.run.withSuccessHandler(function(response) {
        console.log(`Due date update successful: ${response.message}`);
        showToast('success', 'Fecha actualizada', response.message);
        
        // Update UI
        const date = new Date(newDate);
        const formattedDate = `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
        selectedDateElement.innerHTML = `<i class="bi bi-calendar-event"></i>${formattedDate}`;
        
        closeDatePicker();
    }).withFailureHandler(function(error) {
        handleGASError(error, 'actualización de fecha de vencimiento');
    }).updateExpedienteDueDate(selectedDateId, newDate);
    */
}

// Close modals when clicking outside
document.addEventListener('click', function(event) {
    if (event.target.classList.contains('modal-overlay')) {
        event.target.classList.remove('active');
    }

});

