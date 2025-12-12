// server.js - Endpoint server-side seguro para gestión de roles de administrador
// Requiere: node-fetch (o fetch nativo), express
// ENV variables requeridas:
//   SUPABASE_URL (ej: https://xxxxx.supabase.co)
//   SUPABASE_ANON_KEY (public anon key)
//   SUPABASE_SERVICE_ROLE_KEY (secret service_role key - NUNCA en cliente)

import 'dotenv/config';
import express from 'express';
import cors from 'cors';

const app = express();
app.use(express.json());
app.use(cors()); // Configura CORS según tus necesidades

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Validación de variables de entorno
if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('ERROR: Faltan variables de entorno requeridas');
  process.exit(1);
}

// Helper: Obtener usuario desde access token
async function getUserFromToken(accessToken) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${accessToken}`
    }
  });
  
  if (!response.ok) {
    throw new Error('Token inválido o expirado');
  }
  
  return await response.json();
}

// Helper: Verificar si un usuario es administrador
async function isUserAdmin(userId) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    headers: {
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
    }
  });
  
  if (!response.ok) {
    throw new Error('No se pudo verificar el usuario');
  }
  
  const userData = await response.json();
  return userData.is_super_admin === true;
}

// Helper: Actualizar rol de administrador
async function updateAdminStatus(targetUserId, makeAdmin) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${targetUserId}`, {
    method: 'PUT',
    headers: {
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      user_metadata: {}, // Mantener metadata existente
      app_metadata: {
        is_super_admin: makeAdmin
      }
    })
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Error actualizando usuario: ${error}`);
  }
  
  return await response.json();
}

// POST /admin/set-admin
// Body: { targetUserId: string, makeAdmin: boolean }
// Headers: Authorization: Bearer <access_token>
app.post('/admin/set-admin', async (req, res) => {
  try {
    // 1. Extraer y validar token de autorización
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        error: 'No se proporcionó token de autorización' 
      });
    }
    
    const accessToken = authHeader.substring(7); // Quitar "Bearer "
    
    // 2. Validar body
    const { targetUserId, makeAdmin } = req.body;
    if (!targetUserId || typeof makeAdmin !== 'boolean') {
      return res.status(400).json({ 
        error: 'Parámetros inválidos. Se requiere targetUserId (string) y makeAdmin (boolean)' 
      });
    }
    
    // 3. Obtener usuario que hace la petición
    const callerUser = await getUserFromToken(accessToken);
    console.log(`Solicitud de ${callerUser.email} para cambiar rol de usuario ${targetUserId}`);
    
    // 4. Verificar que el usuario que llama es administrador
    const callerIsAdmin = await isUserAdmin(callerUser.id);
    if (!callerIsAdmin) {
      console.warn(`Usuario ${callerUser.email} intentó cambiar roles sin ser administrador`);
      return res.status(403).json({ 
        error: 'No tienes permisos de administrador para realizar esta acción' 
      });
    }
    
    // 5. Prevenir que un admin se quite sus propios permisos
    if (callerUser.id === targetUserId && !makeAdmin) {
      return res.status(400).json({ 
        error: 'No puedes quitarte tus propios permisos de administrador' 
      });
    }
    
    // 6. Actualizar el rol del usuario objetivo
    const updatedUser = await updateAdminStatus(targetUserId, makeAdmin);
    
    // 7. Logging de auditoría (opcional: guardar en tabla audit_admin_actions)
    console.log(`✓ Usuario ${callerUser.email} ${makeAdmin ? 'promovió' : 'revocó'} permisos admin de usuario ${targetUserId}`);
    
    res.json({ 
      success: true, 
      message: makeAdmin ? 'Usuario promovido a administrador' : 'Permisos de administrador revocados',
      user: {
        id: updatedUser.id,
        email: updatedUser.email,
        is_super_admin: makeAdmin
      }
    });
    
  } catch (error) {
    console.error('Error en /admin/set-admin:', error);
    res.status(500).json({ 
      error: error.message || 'Error interno del servidor' 
    });
  }
});

// GET /admin/check - Verificar si el usuario actual es administrador
app.get('/admin/check', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ isAdmin: false });
    }
    
    const accessToken = authHeader.substring(7);
    const user = await getUserFromToken(accessToken);
    const isAdmin = await isUserAdmin(user.id);
    
    res.json({ 
      isAdmin,
      user: {
        id: user.id,
        email: user.email
      }
    });
    
  } catch (error) {
    res.status(401).json({ isAdmin: false, error: error.message });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor de administración ejecutándose en puerto ${PORT}`);
  console.log(`📍 Endpoints disponibles:`);
  console.log(`   POST /admin/set-admin - Cambiar rol de administrador`);
  console.log(`   GET  /admin/check - Verificar si usuario es admin`);
  console.log(`   GET  /health - Health check`);
});
