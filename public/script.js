// Variable global para el cliente de Supabase
let supabase;

// Constantes para claves del Local Storage
const SUPABASE_URL_KEY = 'supabaseUrl';
const SUPABASE_ANON_KEY = 'supabaseAnonKey';
const ADMIN_EMAIL_KEY = 'adminEmail';

// --- CONFIGURACIÓN E INICIALIZACIÓN ---

/**
 * Carga la configuración del servidor y luego inicializa la aplicación.
 * Este es el punto de entrada principal del script.
 */
async function loadConfigAndInit() {
    toggleLoading(true);
    try {
        console.log("Cargando configuración del servidor...");
        const response = await fetch('/config');

        if (!response.ok) {
            throw new Error(`Error al obtener la configuración: ${response.statusText}`);
        }

        const config = await response.json();

        // Validar que las claves de Supabase se recibieron correctamente
        if (!config.supabaseUrl || !config.supabaseAnonKey) {
            throw new Error('Las claves de Supabase no se recibieron del servidor.');
        }

        console.log("Configuración recibida. Inicializando Supabase...");

        // Almacenar en Local Storage para uso futuro
        localStorage.setItem(SUPABASE_URL_KEY, config.supabaseUrl);
        localStorage.setItem(SUPABASE_ANON_KEY, config.supabaseAnonKey);

        // Crear el cliente de Supabase
        supabase = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
        console.log("Cliente de Supabase inicializado.");

        // Continuar con la inicialización de la aplicación
        await initializeApp();

    } catch (error) {
        console.error("Error crítico durante la inicialización:", error);
        showAuthError(`No se pudo cargar la configuración del servidor. Por favor, recargue la página. Detalles: ${error.message}`);
    } finally {
        toggleLoading(false);
    }
}

/**
 * Inicializa la aplicación después de cargar la configuración de Supabase.
 * Verifica el estado de autenticación del usuario.
 */
async function initializeApp() {
    console.log("Inicializando la aplicación...");

    // Intentar obtener la sesión del usuario
    const { data: { session }, error } = await supabase.auth.getSession();

    if (error) {
        console.error("Error al obtener la sesión:", error);
        showAuthError("Hubo un problema al verificar tu sesión. Inténtalo de nuevo.");
        return;
    }

    if (session) {
        console.log("Sesión activa encontrada. Usuario autenticado:", session.user.email);
        const isAdmin = await checkAdminStatus(session.user);
        showApp(session.user, isAdmin);
    } else {
        console.log("No hay sesión activa. Mostrando formulario de login.");
        showLogin();
    }

    // Configurar listeners de eventos
    setupEventListeners();
}

// --- MANEJO DE LA INTERFAZ DE USUARIO (UI) ---

/**
 * Muestra u oculta el overlay de carga.
 * @param {boolean} isLoading - True para mostrar, false para ocultar.
 */
function toggleLoading(isLoading) {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) {
        overlay.classList.toggle('active', isLoading);
    }
}

/**
 * Muestra un mensaje de error en el formulario de autenticación.
 * @param {string} message - El mensaje de error a mostrar.
 */
function showAuthError(message) {
    const loginAlert = document.getElementById('loginAlert');
    loginAlert.innerHTML = `<i class="bi bi-exclamation-triangle"></i><span>${message}</span>`;
    loginAlert.style.display = 'block';
    console.error("Error de autenticación mostrado:", message);
}

/**
 * Oculta el mensaje de error del formulario de autenticación.
 */
function hideAuthError() {
    const loginAlert = document.getElementById('loginAlert');
    loginAlert.style.display = 'none';
}

/**
 * Muestra la aplicación principal y oculta la autenticación.
 * @param {object} user - El objeto de usuario de Supabase.
 * @param {boolean} isAdmin - Si el usuario es administrador.
 */
function showApp(user, isAdmin) {
    document.getElementById('authContainer').classList.add('d-none');
    document.getElementById('appContainer').classList.remove('d-none');
    document.getElementById('userName').textContent = user.email.split('@')[0];

    // Ocultar secciones de administrador si el usuario no es admin
    const adminSections = document.querySelectorAll('.admin-section, .admin-badge');
    adminSections.forEach(section => {
        section.style.display = isAdmin ? 'block' : 'none';
    });

    // Cargar datos iniciales del dashboard
    loadDashboardData();
}

/**
 * Muestra el formulario de login y oculta la aplicación principal.
 */
function showLogin() {
    document.getElementById('authContainer').classList.remove('d-none');
    document.getElementById('appContainer').classList.add('d-none');
}

/**
 * Cambia la sección visible en el contenido principal.
 * @param {string} sectionId - El ID de la sección a mostrar.
 */
function showSection(sectionId) {
    // Ocultar todas las secciones
    document.querySelectorAll('.content-section').forEach(section => {
        section.classList.remove('active');
    });

    // Mostrar la sección seleccionada
    const activeSection = document.getElementById(sectionId);
    if (activeSection) {
        activeSection.classList.add('active');
        document.getElementById('pageTitle').textContent = document.querySelector(`.sidebar-menu a[onclick="showSection('${sectionId}')"]`).textContent;
    }

    // Actualizar el estado 'active' en el menú
    document.querySelectorAll('.sidebar-menu a').forEach(link => {
        link.classList.remove('active');
    });
    document.querySelector(`.sidebar-menu a[onclick="showSection('${sectionId}')"]`).classList.add('active');
}

/**
 * Alterna la visibilidad de la barra lateral en dispositivos móviles.
 */
function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('active');
}

// --- AUTENTICACIÓN ---

/**
 * Maneja el envío del formulario de login.
 * @param {Event} e - El evento de envío del formulario.
 */
async function handleLogin(e) {
    e.preventDefault();
    hideAuthError();
    toggleLoading(true);

    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;

    // Validar el dominio del correo electrónico
    if (!email.endsWith('@gescon360.es')) {
        showAuthError("El correo debe pertenecer al dominio @gescon360.es");
        toggleLoading(false);
        return;
    }

    try {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });

        if (error) {
            throw new Error(error.message);
        }

        if (data.user) {
            console.log("Login exitoso para:", data.user.email);
            const isAdmin = await checkAdminStatus(data.user);
            showApp(data.user, isAdmin);
        } else {
            showAuthError("No se pudo iniciar sesión. Verifique sus credenciales.");
        }

    } catch (error) {
        console.error("Error durante el login:", error);
        showAuthError("Credenciales incorrectas o problema de conexión.");
    } finally {
        toggleLoading(false);
    }
}

/**
 * Cierra la sesión del usuario.
 */
async function logout() {
    toggleLoading(true);
    const { error } = await supabase.auth.signOut();
    if (error) {
        console.error("Error al cerrar sesión:", error);
    }
    showLogin();
    toggleLoading(false);
}

/**
 * Comprueba si un usuario tiene rol de administrador.
 * @param {object} user - El objeto de usuario de Supabase.
 * @returns {Promise<boolean>} - True si es admin, false en caso contrario.
 */
async function checkAdminStatus(user) {
    // Lógica de fallback para administradores si la base de datos no está disponible
    // Esto es MENOS seguro y solo debe usarse como último recurso en desarrollo.
    const adminEmailFallback = 'jesus.mp@gescon360.es';
    if (user.email === adminEmailFallback) {
        console.warn("Usando fallback de verificación de admin para:", user.email);
        localStorage.setItem(ADMIN_EMAIL_KEY, user.email);
        return true;
    }

    try {
        // En un entorno real, aquí se haría una llamada a una tabla 'profiles' o similar
        // para verificar el rol del usuario de forma segura.
        // const { data, error } = await supabase
        //     .from('profiles')
        //     .select('is_admin')
        //     .eq('id', user.id)
        //     .single();

        // if (error) throw error;
        // return data.is_admin;
        return false; // Por defecto, nadie es admin hasta implementar la lógica segura.

    } catch (error) {
        console.error("Error al verificar el estado de admin:", error);
        return false;
    }
}

// --- LÓGICA DEL DASHBOARD ---

/**
 * Carga los datos iniciales para las tarjetas de estadísticas del dashboard.
 */
function loadDashboardData() {
    // Simulación de carga de datos
    document.getElementById('totalExpedients').textContent = '1,247';
    document.getElementById('pendingExpedients').textContent = '156';
    document.getElementById('processExpedients').textContent = '1,091';
    document.getElementById('dueTodayExpedients').textContent = '12';
}

/**
 * Realiza una búsqueda de expedientes (simulada).
 */
function searchExpedients() {
    const searchResults = document.getElementById('searchResults');
    const tableBody = document.getElementById('searchResultsTable');
    const resultCount = document.getElementById('resultCount');

    searchResults.style.display = 'block';
    tableBody.innerHTML = `
        <tr>
            <td>EXP-2024-001</td>
            <td>POL-123456</td>
            <td>SGR-001234</td>
            <td>Juan Pérez</td>
            <td>12345678Z</td>
            <td><span class="status-badge status-en-proceso">En Proceso</span></td>
            <td>20/12/2024</td>
            <td>€5,000.00</td>
            <td><button class="btn btn-sm btn-outline-primary"><i class="bi bi-eye"></i></button></td>
        </tr>
    `;
    resultCount.textContent = '1 resultado encontrado';
}

/**
 * Limpia los campos y resultados de búsqueda.
 */
function clearSearch() {
    document.getElementById('searchExpedient').value = '';
    document.getElementById('searchPolicy').value = '';
    document.getElementById('searchSGR').value = '';
    document.getElementById('searchDNI').value = '';
    document.getElementById('searchResults').style.display = 'none';
}


// --- CONFIGURACIÓN DE EVENT LISTENERS ---

/**
 * Configura todos los listeners de eventos de la aplicación.
 */
function setupEventListeners() {
    console.log("Configurando listeners de eventos...");

    // Formulario de Login
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', handleLogin);
    } else {
        console.error("No se encontró el formulario de login.");
    }

    // Toggle de contraseña
    const togglePassword = document.getElementById('togglePassword');
    if (togglePassword) {
        togglePassword.addEventListener('click', () => {
            const passwordInput = document.getElementById('loginPassword');
            const icon = togglePassword.querySelector('i');
            if (passwordInput.type === 'password') {
                passwordInput.type = 'text';
                icon.classList.remove('bi-eye');
                icon.classList.add('bi-eye-slash');
            } else {
                passwordInput.type = 'password';
                icon.classList.remove('bi-eye-slash');
                icon.classList.add('bi-eye');
            }
        });
    }

    // Drag and drop para subida de archivos
    const fileUploadContainer = document.getElementById('fileUploadContainer');
    const importFile = document.getElementById('importFile');
    if (fileUploadContainer && importFile) {
        fileUploadContainer.addEventListener('click', () => importFile.click());
        fileUploadContainer.addEventListener('dragover', (e) => {
            e.preventDefault();
            fileUploadContainer.classList.add('dragover');
        });
        fileUploadContainer.addEventListener('dragleave', () => {
            fileUploadContainer.classList.remove('dragover');
        });
        fileUploadContainer.addEventListener('drop', (e) => {
            e.preventDefault();
            fileUploadContainer.classList.remove('dragover');
            if (e.dataTransfer.files.length > 0) {
                importFile.files = e.dataTransfer.files;
                handleFileSelect(importFile.files[0]);
            }
        });
        importFile.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                handleFileSelect(e.target.files[0]);
            }
        });
    }
}

/**
 * Maneja la selección de un archivo para importar.
 * @param {File} file - El archivo seleccionado.
 */
function handleFileSelect(file) {
    const fileInfo = document.getElementById('fileInfo');
    const fileName = document.getElementById('fileName');
    const fileSize = document.getElementById('fileSize');

    fileName.textContent = file.name;
    fileSize.textContent = `${(file.size / 1024 / 1024).toFixed(2)} MB`;
    fileInfo.style.display = 'block';

    // Aquí se podría iniciar la subida o el pre-procesamiento del archivo
}

// --- PUNTO DE ENTRADA ---

// Iniciar la aplicación cuando el DOM esté completamente cargado.
document.addEventListener('DOMContentLoaded', loadConfigAndInit);
