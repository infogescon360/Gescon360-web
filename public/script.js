// /script.js

// ============================================================================
// CONFIGURACIÓN E INICIALIZACIÓN DE SUPABASE
// ============================================================================
// IMPORTANTE: Estas son claves de ejemplo. Deben ser reemplazadas por las
// credenciales reales del proyecto en un entorno de producción.
// ============================================================================

let supabase;

async function initializeSupabase() {
    try {
        const response = await fetch('/config');
        if (!response.ok) {
            throw new Error(`Error fetching config: ${response.statusText}`);
        }
        const config = await response.json();

        if (!config.supabaseUrl || !config.supabaseAnonKey) {
            throw new Error('Supabase URL or Anon Key is missing in config.');
        }

        if (window.supabase) {
            supabase = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
            console.log('Supabase client initialized with dynamic config.');
        } else {
            throw new Error('Supabase library not loaded.');
        }
    } catch (error) {
        console.error('Failed to initialize Supabase client:', error);
        alert('Critical Error: Could not connect to the database. The application will not function.');
    }
}

// ============================================================================
// LÓGICA DE AUTENTICACIÓN
// ============================================================================

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Initialize Supabase
    await initializeSupabase();

    // 2. Revisar si hay una sesión activa al cargar la página
    checkSession();

    // 2. Asignar el manejador de eventos al formulario de login
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', handleLogin);
    }
});

async function checkSession() {
    // Esta función es un placeholder. La funcionalidad real de sesión de Supabase
    // es manejada a través de su sistema de tokens y localStorage.
    // Aquí, simulamos una comprobación para mostrar la app si el token existe.

    const sessionToken = localStorage.getItem('supabase.auth.token');
    if (sessionToken) {
        try {
            const session = JSON.parse(sessionToken);
            // Podríamos añadir una validación del token aquí si fuese necesario
            if (session && session.user) {
                console.log('Sesión encontrada. Mostrando la aplicación.');
                showApp();
            }
        } catch (e) {
            console.error('Error al parsear el token de sesión:', e);
            localStorage.removeItem('supabase.auth.token'); // Limpiar token corrupto
        }
    } else {
        console.log('No se encontró sesión. Mostrando formulario de login.');
    }
}

async function handleLogin(event) {
    event.preventDefault();
    setLoading(true);

    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;

    if (!email || !password) {
        showAuthError('Por favor, introduce tu email y código de seguridad.');
        setLoading(false);
        return;
    }
    if (!email.endsWith('@gescon360.es')) {
        showAuthError('El email debe pertenecer al dominio @gescon360.es.');
        setLoading(false);
        return;
    }

    try {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
            // Only show a generic error message. Do not reveal if the user exists.
            throw new Error('Credenciales inválidas. Por favor, verifica tu email y código de seguridad.');
        }
        await verifyAdminAndGrantAccess(data.session);
    } catch (error) {
        console.error('Error en el inicio de sesión:', error.message);
        showAuthError(error.message); // Muestra el mensaje de error específico
    } finally {
        setLoading(false);
    }
}

async function verifyAdminAndGrantAccess(session) {
    if (!session || !session.user) {
        showAuthError('La sesión de autenticación no es válida.');
        return;
    }

    try {
        // Usa una ruta relativa para la llamada al backend
        const response = await fetch('/admin/check', {
            headers: { 'Authorization': `Bearer ${session.access_token}` }
        });

        // Si la respuesta no es OK (p.ej. 500, 404), entra en el fallback si es el admin
        if (!response.ok) {
            if (session.user.email === 'jesus.mp@gescon360.es') {
                console.warn(`El backend devolvió un estado ${response.status}. Usando fallback para el administrador.`);
                grantAdminAccessFallback();
                return;
            } else {
                // Para otros usuarios, es un error
                throw new Error('No se pudo verificar el estado de administrador.');
            }
        }

        const data = await response.json();
        if (data.isAdmin) {
            console.log(`Acceso concedido para el administrador: ${session.user.email}`);
            localStorage.setItem('supabase.auth.token', JSON.stringify(session));
            showApp();
        } else {
            showAuthError('No tienes permisos de administrador.');
            await supabase.auth.signOut();
        }
    } catch (error) {
        console.error('Error verificando el estado de admin:', error);
        if (session.user.email === 'jesus.mp@gescon360.es') {
            console.warn('Error de red al contactar el backend. Usando fallback para el administrador.');
            grantAdminAccessFallback();
        } else {
            showAuthError('Error de red al verificar permisos. Inténtalo de nuevo.');
        }
    }
}

function grantAdminAccessFallback() {
    console.log('Acceso de administrador concedido mediante fallback local.');
    showApp(true);
}

function showApp(isFallback = false) {
    const authContainer = document.getElementById('authContainer');
    const appContainer = document.getElementById('appContainer');
    const userNameEl = document.getElementById('userName');

    if (isFallback) {
        userNameEl.textContent = 'Admin (Fallback)';
    } else {
        const session = JSON.parse(localStorage.getItem('supabase.auth.token'));
        if (session && session.user && session.user.email) {
            userNameEl.textContent = session.user.email.split('@')[0];
        }
    }

    authContainer.classList.add('d-none');
    appContainer.classList.remove('d-none');
}

function showAuthError(message) {
    console.error(`Auth Error: ${message}`);
    alert(message);
}

function setLoading(isLoading) {
    const loginButton = document.getElementById('loginButton');
    const loginButtonText = document.getElementById('loginButtonText');
    const loginSpinner = document.getElementById('loginSpinner');

    if (isLoading) {
        loginButton.disabled = true;
        loginButtonText.textContent = 'Verificando...';
        loginSpinner.classList.remove('d-none');
    } else {
        loginButton.disabled = false;
        loginButtonText.textContent = 'Iniciar Sesión';
        loginSpinner.classList.add('d-none');
    }
}

async function logout() {
    console.log('Cerrando sesión...');

    // 1. Limpiar el token de sesión
    localStorage.removeItem('supabase.auth.token');

    // 2. (Opcional) Llamar a signOut de Supabase para invalidar el token en el servidor
    if (supabase) {
        const { error } = await supabase.auth.signOut();
        if (error) {
            console.error('Error durante el signOut de Supabase:', error.message);
        }
    }

    // 3. Redirigir a la página de login
    // En este caso, simplemente mostramos/ocultamos los contenedores
    const authContainer = document.getElementById('authContainer');
    const appContainer = document.getElementById('appContainer');

    appContainer.classList.add('d-none');
    authContainer.classList.remove('d-none');

    // 4. Limpiar el formulario por si acaso
    const emailInput = document.getElementById('loginEmail');
    const passwordInput = document.getElementById('loginPassword');
    if (emailInput) emailInput.value = '';
    if (passwordInput) passwordInput.value = '';
}

// ============================================================================
// LÓGICA DE LA INTERFAZ DE USUARIO (UI)
// ============================================================================

function showSection(sectionId) {
    // Ocultar todas las secciones
    const sections = document.querySelectorAll('.content-section');
    sections.forEach(section => {
        section.classList.remove('active');
    });

    // Mostrar la sección seleccionada
    const activeSection = document.getElementById(sectionId);
    if (activeSection) {
        activeSection.classList.add('active');
    }

    // Actualizar el título de la página
    const pageTitle = document.getElementById('pageTitle');
    const sectionLink = document.querySelector(`.sidebar-menu a[onclick="showSection('${sectionId}')"]`);
    if (pageTitle && sectionLink) {
        pageTitle.textContent = sectionLink.textContent;
    }

    // Actualizar el estado activo en el menú de la barra lateral
    const navLinks = document.querySelectorAll('.sidebar-menu a');
    navLinks.forEach(link => {
        link.classList.remove('active');
    });
    if (sectionLink) {
        sectionLink.classList.add('active');
    }
}

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    if (sidebar) {
        sidebar.classList.toggle('open');
    }
}
