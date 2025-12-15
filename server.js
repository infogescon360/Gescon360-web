// server.js - Backend seguro para gestión de roles de administrador y tareas

import 'dotenv/config';
import express from 'express';
import cors from 'cors';

// Si tu Node es < 18, descomenta esto y añade node-fetch como dependencia:
// import fetch from 'node-fetch';

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static('public'));

// Configurar CSP para permitir SheetJS CDN
app.use((req, res, next) => {
    res.setHeader(
          'Content-Security-Policy',
          "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; connect-src 'self' https://*.supabase.co;"
        );
    next();
  });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_KEY = process.env.SUPABASE_KEY; // clave para @supabase/supabase-js (igual que la que usas en script.js)

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_KEY) {
  console.error('ERROR: Faltan variables de entorno requeridas');
  process.exit(1);
}

// ---------------------------------------------------------------------
// Supabase client (para expedientes/tareas)
// ---------------------------------------------------------------------
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ---------------------------------------------------------------------
// Helpers de autenticación / roles
// ---------------------------------------------------------------------
async function getUserFromToken(accessToken) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error('Token inválido o expirado');
  }

  return await response.json();
}

async function isUserAdmin(userId) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });

  if (!response.ok) {
    throw new Error('No se pudo verificar el usuario');
  }

  const userData = await response.json();
  return userData.is_super_admin === true;
}

async function updateAdminStatus(targetUserId, makeAdmin) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${targetUserId}`, {
    method: 'PUT',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      user_metadata: {},
      app_metadata: {
        is_super_admin: makeAdmin,
      },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Error actualizando usuario: ${error}`);
  }

  return await response.json();
}

// ---------------------------------------------------------------------
// Endpoints de administración
// ---------------------------------------------------------------------
app.post('/admin/set-admin', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res
        .status(401)
        .json({ error: 'No se proporcionó token de autorización' });
    }

    const accessToken = authHeader.substring(7);

    const { targetUserId, makeAdmin } = req.body;
    if (!targetUserId || typeof makeAdmin !== 'boolean') {
      return res.status(400).json({
        error:
          'Parámetros inválidos. Se requiere targetUserId (string) y makeAdmin (boolean)',
      });
    }

    const callerUser = await getUserFromToken(accessToken);
    console.log(
      `Solicitud de ${callerUser.email} para cambiar rol de usuario ${targetUserId}`
    );

    const callerIsAdmin = await isUserAdmin(callerUser.id);
    if (!callerIsAdmin) {
      console.warn(
        `Usuario ${callerUser.email} intentó cambiar roles sin ser administrador`
      );
      return res.status(403).json({
        error: 'No tienes permisos de administrador para realizar esta acción',
      });
    }

    if (callerUser.id === targetUserId && !makeAdmin) {
      return res.status(400).json({
        error: 'No puedes quitarte tus propios permisos de administrador',
      });
    }

    const updatedUser = await updateAdminStatus(targetUserId, makeAdmin);

    console.log(
      `✓ Usuario ${callerUser.email} ${
        makeAdmin ? 'promovió' : 'revocó'
      } permisos admin de usuario ${targetUserId}`
    );

    res.json({
      success: true,
      message: makeAdmin
        ? 'Usuario promovido a administrador'
        : 'Permisos de administrador revocados',
      user: {
        id: updatedUser.id,
        email: updatedUser.email,
        is_super_admin: makeAdmin,
      },
    });
  } catch (error) {
    console.error('Error en /admin/set-admin:', error);
    res.status(500).json({
      error: error.message || 'Error interno del servidor',
    });
  }
});

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
        email: user.email,
      },
    });
  } catch (error) {
    res.status(401).json({ isAdmin: false, error: error.message });
  }
});

// ---------------------------------------------------------------------
// Endpoints de configuración y health
// ---------------------------------------------------------------------
app.get('/config', (req, res) => {
  res.json({
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: SUPABASE_ANON_KEY,
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ---------------------------------------------------------------------
// Endpoints de tareas / expedientes
// ---------------------------------------------------------------------
app.get('/api/tareas', async (req, res) => {
  try {
    const { gestorId, estado, vencenHoy } = req.query;

    let query = supabase.from('expedientes').select('*');

    if (gestorId) query = query.eq('gestor_id', gestorId);
    if (estado) query = query.eq('estado', estado);

    if (vencenHoy === 'true') {
      const hoy = new Date();
      const iso = hoy.toISOString().slice(0, 10); // YYYY-MM-DD
      query = query.eq('fecha_seguimiento', iso);
    }

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/tareas/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const cambios = req.body;

    const estadosFinales = [
      'Finalizado - Recobro total',
      'Finalizado - Recobro parcial',
      'Rehusado',
      'Datos no válidos',
    ];

    if (estadosFinales.includes(cambios.estado)) {
      const { data: expData, error: getErr } = await supabase
        .from('expedientes')
        .select('*')
        .eq('id', id)
        .single();
      if (getErr) return res.status(500).json({ error: getErr.message });

      const archivado = {
        ...expData,
        ...cambios,
        motivo_archivo: cambios.estado,
      };

      const { error: insErr } = await supabase
        .from('expedientes_archivados')
        .insert(archivado);
      if (insErr) return res.status(500).json({ error: insErr.message });

      await supabase.from('expedientes').delete().eq('id', id);

      return res.json({ ok: true, archivado: true });
    }

    const { data, error } = await supabase
      .from('expedientes')
      .update(cambios)
      .eq('id', id)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


// ---------------------------------------------------------------------
// Endpoints adicionales para búsqueda, duplicados, archivados y reportes
// ---------------------------------------------------------------------

// Búsqueda avanzada de expedientes
app.get('/api/expedientes/buscar', async (req, res) => {
  try {
    const { expediente, poliza, sgr, dni } = req.query;
    let query = supabase.from('expedientes').select('*');
    
    if (expediente) query = query.ilike('numero_expediente', `%${expediente}%`);
    if (poliza) query = query.ilike('numero_poliza', `%${poliza}%`);
    if (sgr) query = query.ilike('numero_sgr', `%${sgr}%`);
    if (dni) query = query.ilike('dni', `%${dni}%`);
    
    const { data, error } = await query.limit(100);
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Verificar duplicados
app.post('/api/duplicados/verificar', async (req, res) => {
  try {
    const { expedientes } = req.body;
    if (!Array.isArray(expedientes)) {
      return res.status(400).json({ error: 'Se requiere un array de expedientes' });
    }
    
    const duplicados = [];
    for (const exp of expedientes) {
      const { data, error } = await supabase
        .from('expedientes')
        .select('*')
        .or(`numero_expediente.eq.${exp.numero_expediente},numero_poliza.eq.${exp.numero_poliza},dni.eq.${exp.dni}`);
      
      if (error) continue;
      if (data && data.length > 0) {
        duplicados.push({
          nuevo: exp,
          existente: data[0],
          motivo: 'Coincide expediente, póliza o DNI'
        });
      }
    }
    
    res.json({ duplicados, total: duplicados.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Obtener expedientes archivados
app.get('/api/archivados', async (req, res) => {
  try {
    const { motivo, desde, hasta, limite = 50 } = req.query;
    let query = supabase.from('expedientes_archivados').select('*');
    
    if (motivo) query = query.eq('motivo_archivo', motivo);
    if (desde) query = query.gte('created_at', desde);
    if (hasta) query = query.lte('created_at', hasta);
    
    query = query.order('created_at', { ascending: false }).limit(parseInt(limite));
    
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Restaurar expediente archivado
app.post('/api/archivados/:id/restaurar', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Obtener el expediente archivado
    const { data: archivado, error: getErr } = await supabase
      .from('expedientes_archivados')
      .select('*')
      .eq('id', id)
      .single();
    
    if (getErr) return res.status(500).json({ error: getErr.message });
    
    // Insertar en expedientes activos
    const { error: insErr } = await supabase
      .from('expedientes')
      .insert({
        ...archivado,
        estado: 'En proceso'
      });
    
    if (insErr) return res.status(500).json({ error: insErr.message });
    
    // Eliminar de archivados
    await supabase.from('expedientes_archivados').delete().eq('id', id);
    
    res.json({ ok: true, message: 'Expediente restaurado correctamente' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Generar reporte de estadísticas
app.get('/api/reportes/estadisticas', async (req, res) => {
  try {
    const { desde, hasta } = req.query;
    
    // Expedientes totales
    let queryTotal = supabase.from('expedientes').select('*', { count: 'exact', head: true });
    const { count: total } = await queryTotal;
    
    // Por estado
    const estados = ['Pendiente', 'En proceso', 'Finalizado', 'Archivado'];
    const porEstado = {};
    
    for (const estado of estados) {
      const { count } = await supabase
        .from('expedientes')
        .select('*', { count: 'exact', head: true })
        .eq('estado', estado);
      porEstado[estado] = count || 0;
    }
    
    // Archivados
    const { count: archivados } = await supabase
      .from('expedientes_archivados')
      .select('*', { count: 'exact', head: true });
    
    res.json({
      total,
      porEstado,
      archivados,
      fecha_generacion: new Date().toISOString()
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Importar expedientes en lote
app.post('/api/expedientes/importar', async (req, res) => {
  try {
    const { expedientes, opciones } = req.body;
    
    if (!Array.isArray(expedientes)) {
      return res.status(400).json({ error: 'Se requiere un array de expedientes' });
    }
    
    const resultados = {
      exitosos: [],
      duplicados: [],
      errores: []
    };
    
    for (const exp of expedientes) {
      try {
        // Verificar duplicados si está habilitado
        if (opciones?.verificarDuplicados) {
          const { data: existe } = await supabase
            .from('expedientes')
            .select('id')
            .eq('numero_expediente', exp.numero_expediente)
            .single();
          
          if (existe) {
            resultados.duplicados.push(exp);
            continue;
          }
        }
        
        // Insertar expediente
        const { data, error } = await supabase
          .from('expedientes')
          .insert(exp)
          .select()
          .single();
        
        if (error) throw error;
        resultados.exitosos.push(data);
      } catch (err) {
        resultados.errores.push({
          expediente: exp,
          error: err.message
        });
      }
    }
    
    res.json(resultados);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------
// Arranque del servidor
// ---------------------------------------------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor ejecutándose en puerto ${PORT}`);
  console.log('📍 Endpoints:');
  console.log('   POST /admin/set-admin');
  console.log('   GET  /admin/check');
  console.log('   GET  /config');
  console.log('   GET  /api/tareas');
  console.log('   PATCH /api/tareas/:id');
  console.log('   GET  /health');
    console.log('   GET    /api/expedientes/buscar');
  console.log('   POST   /api/duplicados/verificar');
  console.log('   GET    /api/archivados');
  console.log('   POST   /api/archivados/:id/restaurar');
  console.log('   GET    /api/reportes/estadisticas');
  console.log('   POST   /api/expedientes/importar');
});





