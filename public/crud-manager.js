/**
 * ================================================================================
 * GESCON 360 - CRUD Manager
 * ================================================================================
 * Módulo para gestión de Clientes, Pólizas y Siniestros
 * Integración con endpoints backend: /api/clientes, /api/polizas, /api/siniestros
 * ================================================================================
 */

// ============================================================================
// CONFIGURACIÓN Y UTILIDADES
// ============================================================================

const API_BASE_URL = window.location.origin;

/**
 * Realizar petición HTTP al backend
 * @param {string} endpoint - Ruta del endpoint (ej: '/api/clientes')
 * @param {object} options - Opciones de fetch (method, body, headers)
 * @returns {Promise<object>} - Respuesta JSON del servidor
 */
async function apiRequest(endpoint, options = {}) {
    try {
        const defaultOptions = {
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            }
        };

        const response = await fetch(`${API_BASE_URL}${endpoint}`, {
            ...defaultOptions,
            ...options
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || `Error ${response.status}`);
        }

        return data;
    } catch (error) {
        console.error(`API Request Error [${endpoint}]:`, error);
        throw error;
    }
}

/**
 * Mostrar notificación al usuario
 * @param {string} message - Mensaje a mostrar
 * @param {string} type - Tipo: 'success', 'error', 'warning', 'info'
 */
function showNotification(message, type = 'info') {
    // Mapear 'error' a 'danger' para coincidir con los estilos de script.js
    const toastType = type === 'error' ? 'danger' : type;
    
    // Integración con sistema de notificaciones existente
    if (typeof window.showToast === 'function') {
        // Adaptar a la firma de script.js: showToast(type, title, message)
        window.showToast(toastType, 'Gestión de Datos', message);
    } else {
        console.log(`[${type.toUpperCase()}] ${message}`);
        alert(message);
    }
}

// ============================================================================
// GESTIÓN DE CLIENTES
// ============================================================================

const ClientesManager = {
    /**
     * Obtener lista de clientes
     * @param {object} filters - Filtros: {buscar, limite}
     * @returns {Promise<Array>} - Lista de clientes
     */
    async listar(filters = {}) {
        const params = new URLSearchParams();
        if (filters.buscar) params.append('buscar', filters.buscar);
        if (filters.limite) params.append('limite', filters.limite);
        
        const query = params.toString();
        const endpoint = `/api/clientes${query ? '?' + query : ''}`;
        
        return await apiRequest(endpoint);
    },

    /**
     * Obtener cliente por ID
     * @param {string} id - ID del cliente
     * @returns {Promise<object>} - Datos del cliente
     */
    async obtenerPorId(id) {
        return await apiRequest(`/api/clientes/${id}`);
    },

    /**
     * Crear nuevo cliente
     * @param {object} clienteData - Datos: {nombre, apellidos, dni, email, telefono, direccion}
     * @returns {Promise<object>} - Cliente creado
     */
    async crear(clienteData) {
        const data = await apiRequest('/api/clientes', {
            method: 'POST',
            body: JSON.stringify(clienteData)
        });
        
        showNotification('Cliente creado correctamente', 'success');
        return data;
    },

    /**
     * Actualizar cliente existente
     * @param {string} id - ID del cliente
     * @param {object} clienteData - Datos a actualizar
     * @returns {Promise<object>} - Cliente actualizado
     */
    async actualizar(id, clienteData) {
        const data = await apiRequest(`/api/clientes/${id}`, {
            method: 'PUT',
            body: JSON.stringify(clienteData)
        });
        
        showNotification('Cliente actualizado correctamente', 'success');
        return data;
    },

    /**
     * Eliminar cliente
     * @param {string} id - ID del cliente
     * @returns {Promise<object>} - Confirmación
     */
    async eliminar(id) {
        const confirmacion = confirm('¿Estás seguro de eliminar este cliente?');
        if (!confirmacion) return null;
        
        const data = await apiRequest(`/api/clientes/${id}`, {
            method: 'DELETE'
        });
        
        showNotification('Cliente eliminado correctamente', 'success');
        return data;
    }
};

// ============================================================================
// GESTIÓN DE PÓLIZAS
// ============================================================================

const PolizasManager = {
    /**
     * Obtener lista de pólizas
     * @param {object} filters - Filtros: {cliente_id, buscar, limite}
     * @returns {Promise<Array>} - Lista de pólizas
     */
    async listar(filters = {}) {
        const params = new URLSearchParams();
        if (filters.cliente_id) params.append('cliente_id', filters.cliente_id);
        if (filters.buscar) params.append('buscar', filters.buscar);
        if (filters.limite) params.append('limite', filters.limite);
        
        const query = params.toString();
        const endpoint = `/api/polizas${query ? '?' + query : ''}`;
        
        return await apiRequest(endpoint);
    },

    /**
     * Obtener póliza por ID
     * @param {string} id - ID de la póliza
     * @returns {Promise<object>} - Datos de la póliza
     */
    async obtenerPorId(id) {
        return await apiRequest(`/api/polizas/${id}`);
    },

    /**
     * Crear nueva póliza
     * @param {object} polizaData - Datos: {numero_poliza, cliente_id, tipo_seguro, compania, fecha_inicio, fecha_fin, prima_anual, estado}
     * @returns {Promise<object>} - Póliza creada
     */
    async crear(polizaData) {
        const data = await apiRequest('/api/polizas', {
            method: 'POST',
            body: JSON.stringify(polizaData)
        });
        
        showNotification('Póliza creada correctamente', 'success');
        return data;
    },

    /**
     * Actualizar póliza existente
     * @param {string} id - ID de la póliza
     * @param {object} polizaData - Datos a actualizar
     * @returns {Promise<object>} - Póliza actualizada
     */
    async actualizar(id, polizaData) {
        const data = await apiRequest(`/api/polizas/${id}`, {
            method: 'PUT',
            body: JSON.stringify(polizaData)
        });
        
        showNotification('Póliza actualizada correctamente', 'success');
        return data;
    },

    /**
     * Eliminar póliza
     * @param {string} id - ID de la póliza
     * @returns {Promise<object>} - Confirmación
     */
    async eliminar(id) {
        const confirmacion = confirm('¿Estás seguro de eliminar esta póliza?');
        if (!confirmacion) return null;
        
        const data = await apiRequest(`/api/polizas/${id}`, {
            method: 'DELETE'
        });
        
        showNotification('Póliza eliminada correctamente', 'success');
        return data;
    },

    /**
     * Obtener pólizas de un cliente específico
     * @param {string} clienteId - ID del cliente
     * @returns {Promise<Array>} - Lista de pólizas del cliente
     */
    async obtenerPorCliente(clienteId) {
        return await this.listar({ cliente_id: clienteId });
    }
};

// ============================================================================
// GESTIÓN DE SINIESTROS
// ============================================================================

const SiniestrosManager = {
    /**
     * Obtener lista de siniestros
     * @param {object} filters - Filtros: {poliza_id, buscar, limite}
     * @returns {Promise<Array>} - Lista de siniestros
     */
    async listar(filters = {}) {
        const params = new URLSearchParams();
        if (filters.poliza_id) params.append('poliza_id', filters.poliza_id);
        if (filters.buscar) params.append('buscar', filters.buscar);
        if (filters.limite) params.append('limite', filters.limite);
        
        const query = params.toString();
        const endpoint = `/api/siniestros${query ? '?' + query : ''}`;
        
        return await apiRequest(endpoint);
    },

    /**
     * Obtener siniestro por ID
     * @param {string} id - ID del siniestro
     * @returns {Promise<object>} - Datos del siniestro
     */
    async obtenerPorId(id) {
        return await apiRequest(`/api/siniestros/${id}`);
    },

    /**
     * Crear nuevo siniestro
     * @param {object} siniestroData - Datos: {numero_siniestro, poliza_id, fecha_siniestro, tipo_siniestro, descripcion, estado, importe_estimado}
     * @returns {Promise<object>} - Siniestro creado
     */
    async crear(siniestroData) {
        const data = await apiRequest('/api/siniestros', {
            method: 'POST',
            body: JSON.stringify(siniestroData)
        });
        
        showNotification('Siniestro creado correctamente', 'success');
        return data;
    },

    /**
     * Actualizar siniestro existente
     * @param {string} id - ID del siniestro
     * @param {object} siniestroData - Datos a actualizar
     * @returns {Promise<object>} - Siniestro actualizado
     */
    async actualizar(id, siniestroData) {
        const data = await apiRequest(`/api/siniestros/${id}`, {
            method: 'PUT',
            body: JSON.stringify(siniestroData)
        });
        
        showNotification('Siniestro actualizado correctamente', 'success');
        return data;
    },

    /**
     * Eliminar siniestro
     * @param {string} id - ID del siniestro
     * @returns {Promise<object>} - Confirmación
     */
    async eliminar(id) {
        const confirmacion = confirm('¿Estás seguro de eliminar este siniestro?');
        if (!confirmacion) return null;
        
        const data = await apiRequest(`/api/siniestros/${id}`, {
            method: 'DELETE'
        });
        
        showNotification('Siniestro eliminado correctamente', 'success');
        return data;
    },

    /**
     * Obtener siniestros de una póliza específica
     * @param {string} polizaId - ID de la póliza
     * @returns {Promise<Array>} - Lista de siniestros de la póliza
     */
    async obtenerPorPoliza(polizaId) {
        return await this.listar({ poliza_id: polizaId });
    }
};

// ============================================================================
// EXPORTAR MÓDULOS
// ============================================================================

window.ClientesManager = ClientesManager;
window.PolizasManager = PolizasManager;
window.SiniestrosManager = SiniestrosManager;

console.log('✅ CRUD Manager cargado correctamente');
console.log('📦 Módulos disponibles:', Object.keys({ ClientesManager, PolizasManager, SiniestrosManager }));
