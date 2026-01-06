import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Crear cliente específico para el servicio
const supabaseAdmin = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

/**
 * Servicio de Gestión de Carga de Trabajo (WorkloadService)
 * 
 * Documentación de Uso:
 * 
 * import { WorkloadService } from './services/workload-service.js';
 * 
 * // 1. Obtener estadísticas
 * const stats = await WorkloadService.getCurrentWorkloadStats();
 * 
 * // 2. Marcar usuario inactivo y redistribuir tareas
 * const result = await WorkloadService.redistributeDailyTasks(userId);
 * 
 * // 3. Distribuir expedientes importados
 * await WorkloadService.distributeImportedExpedientes(importLogId, expedienteIds);
 */
export class WorkloadService {
  
  /**
   * FUNCIÓN 1: getActiveUsers()
   * Propósito: Obtener todos los usuarios activos (rol='user')
   * Retorna: Array de usuarios [{id, email}, ...]
   */
  static async getActiveUsers() {
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('id, email')
      .eq('role', 'user')
      .eq('status', 'active')
      .order('id');
    
    if (error) throw error;
    return data || [];
  }

  /**
   * FUNCIÓN 2: getCurrentWorkloadStats()
   * Propósito: Obtener estadísticas actuales de carga de cada usuario
   * Retorna: Array con estadísticas por usuario
   */
  static async getCurrentWorkloadStats() {
    const { data, error } = await supabaseAdmin.rpc('get_workload_stats');
    if (error) throw error;
    return data || [];
  }

  /**
   * FUNCIÓN 3: getDailyReviewTasks(userId)
   * Propósito: Obtener SOLO las tareas que requieren revisión diaria de un usuario
   * Retorna: Array de seguimientos que necesitan revisión diaria
   */
  static async getDailyReviewTasks(userId) {
    if (!userId || typeof userId !== 'string') {
      throw new Error('Invalid user ID');
    }

    const today = new Date().toISOString().split('T')[0];

    // 1. Obtener asignaciones activas del usuario (workload_assignments)
    const { data: assignments, error: waError } = await supabaseAdmin
      .from('workload_assignments')
      .select('id, expediente_id')
      .eq('user_id', userId)
      .eq('status', 'activa');

    if (waError) throw waError;
    if (!assignments || assignments.length === 0) return [];

    const expedienteIds = assignments.map(a => a.expediente_id);

    // 2. Obtener seguimientos que cumplen criterios de revisión
    const { data: seguimientos, error: sError } = await supabaseAdmin
      .from('seguimientos')
      .select('id, expediente_id, status, priority, ultima_revision')
      .in('expediente_id', expedienteIds)
      .in('status', ['pendiente', 'en_proceso'])
      .in('priority', ['alta', 'media'])
      .or(`ultima_revision.is.null,ultima_revision.lt.${today}`);

    if (sError) throw sError;

    // 3. Combinar resultados para incluir assignment_id (Simular JOIN)
    return (seguimientos || []).map(s => {
      const assignment = assignments.find(a => a.expediente_id === s.expediente_id);
      return {
        assignment_id: assignment ? assignment.id : null,
        seguimiento_id: s.id,
        expediente_id: s.expediente_id,
        ...s
      };
    });
  }

  /**
   * FUNCIÓN 4: redistributeDailyTasks(inactiveUserId)
   * Propósito: Redistribuir las tareas diarias de un usuario inactivo
   * Retorna: Objeto con resumen {tasksMoved: X, toUsers: [...]}
   */
  static async redistributeDailyTasks(inactiveUserId) {
    if (!inactiveUserId || typeof inactiveUserId !== 'string') {
      throw new Error('Invalid user ID');
    }

    // OPTIMIZACIÓN 3: Transacciones para Integridad (RPC)
    const { data, error } = await supabaseAdmin.rpc('redistribute_with_transaction', {
      user_id: inactiveUserId
    });
    
    if (error) throw error;
    return data;
  }

  /**
   * FUNCIÓN 5: restoreUserTasks(userId)
   * Propósito: Restaurar tareas originales cuando un usuario se reactiva
   * Retorna: Objeto con resumen {tasksRestored: X}
   */
  static async restoreUserTasks(userId) {
    if (!userId || typeof userId !== 'string') {
      throw new Error('Invalid user ID');
    }

    // PASO 1: Buscar en workload_history las tareas que fueron redistribuidas
    const { data: history, error: historyError } = await supabaseAdmin
      .from('workload_history')
      .select('*')
      .eq('user_id', userId)
      .eq('action', 'redistribucion_inactividad')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (historyError) throw historyError;

    // Si no hay historial o no tiene IDs, solo reactivamos al usuario
    if (!history || !history.details || !history.details.assignment_ids) {
      await supabaseAdmin.from('profiles').update({ status: 'active' }).eq('id', userId);
      return { tasksRestored: 0, message: 'Usuario reactivado. No se encontraron tareas para restaurar.' };
    }

    const assignmentIds = history.details.assignment_ids;
    let tasksRestored = 0;

    if (assignmentIds && assignmentIds.length > 0) {
      // PASO 2 & 3: Restaurar solo las tareas que AÚN NO HAN SIDO COMPLETADAS (status = 'activa')
      
      // Primero identificamos cuáles siguen activas para poder actualizar la tabla expedientes también
      const { data: activeAssignments, error: fetchError } = await supabaseAdmin
        .from('workload_assignments')
        .select('id, expediente_id')
        .in('id', assignmentIds)
        .eq('status', 'activa');

      if (fetchError) throw fetchError;

      if (activeAssignments && activeAssignments.length > 0) {
        const idsToRestore = activeAssignments.map(a => a.id);
        const expIdsToRestore = activeAssignments.map(a => a.expediente_id);

        // Actualizar workload_assignments
        const { error: updateAssignError } = await supabaseAdmin
          .from('workload_assignments')
          .update({
            user_id: userId,
            assignment_type: 'restauracion',
            // notes: 'Restaurado tras reactivación', // Nota: Descomentar si se añade columna 'notes' a la tabla
            assigned_by: null 
          })
          .in('id', idsToRestore);

        if (updateAssignError) throw updateAssignError;

        // Sincronizar expedientes
        const { error: updateExpError } = await supabaseAdmin
          .from('expedientes')
          .update({ gestor_id: userId })
          .in('id', expIdsToRestore);

        if (updateExpError) throw updateExpError;

        tasksRestored = idsToRestore.length;
      }
    }

    // PASO 4: Actualizar estado del usuario
    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .update({ status: 'active' })
      .eq('id', userId);

    if (profileError) throw profileError;

    return { tasksRestored };
  }

  /**
   * FUNCIÓN 6: distributeToNewUser(newUserId, redistributionPercentage = 0.2)
   * Propósito: Al añadir un usuario nuevo, tomar 20% de tareas de cada usuario existente
   * Retorna: Objeto con resumen {tasksAssigned: X, fromUsers: [...]}
   */
  static async distributeToNewUser(newUserId, redistributionPercentage = 0.2) {
    if (!newUserId || typeof newUserId !== 'string') {
      throw new Error('Invalid user ID');
    }

    // PASO 1: Obtener usuarios activos existentes (excluyendo el nuevo)
    const activeUsers = await this.getActiveUsers();
    const existingUsers = activeUsers.filter(u => u.id !== newUserId);
    const newUser = activeUsers.find(u => u.id === newUserId);

    if (existingUsers.length === 0) return { tasksAssigned: 0, fromUsers: [] };

    let totalMoved = 0;
    const fromUsersSummary = [];

    // PASO 2: Por cada usuario existente
    for (const user of existingUsers) {
      // Obtener total de tareas activas para calcular el límite
      const { count } = await supabaseAdmin
        .from('workload_assignments')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('status', 'activa');

      if (!count) continue;

      const limit = Math.ceil(count * redistributionPercentage);
      if (limit === 0) continue;

      // Seleccionar tareas a mover (Prioridad DESC, Asignado ASC)
      const { data: tasksToMove } = await supabaseAdmin
        .from('workload_assignments')
        .select('id, expediente_id')
        .eq('user_id', user.id)
        .eq('status', 'activa')
        .order('priority', { ascending: false })
        .order('assigned_at', { ascending: true })
        .limit(limit);

      if (tasksToMove && tasksToMove.length > 0) {
        const assignmentIds = tasksToMove.map(t => t.id);
        const expedienteIds = tasksToMove.map(t => t.expediente_id);

        // UPDATE assignments
        await supabaseAdmin
          .from('workload_assignments')
          .update({
            user_id: newUserId,
            assignment_type: 'rebalanceo_nuevo_usuario',
            assigned_by: null, // System
            assigned_at: new Date().toISOString()
          })
          .in('id', assignmentIds);

        // UPDATE expedientes (Sincronización)
        await supabaseAdmin
          .from('expedientes')
          .update({ gestor_id: newUserId })
          .in('id', expedienteIds);

        totalMoved += tasksToMove.length;
        fromUsersSummary.push({ email: user.email, count: tasksToMove.length });
      }
    }

    // PASO 3: Registrar en log
    if (totalMoved > 0) {
      await supabaseAdmin
        .from('workload_history')
        .insert({
          user_id: newUserId,
          action: 'rebalanceo_nuevo_usuario',
          details: { tasksAssigned: totalMoved, fromUsers: fromUsersSummary },
          created_at: new Date().toISOString()
        });
    }

    return { 
      tasksAssigned: totalMoved, 
      fromUsers: fromUsersSummary,
      newUserEmail: newUser ? newUser.email : null 
    };
  }

  /**
   * FUNCIÓN 7: distributeImportedExpedientes(importLogId, expedienteIds)
   * Propósito: Distribuir automáticamente nuevos expedientes importados
   * Retorna: Objeto {distributed: X, byUser: {user_id: count}}
   */
  static async distributeImportedExpedientes(importLogId, expedienteIds) {
    if (!expedienteIds || expedienteIds.length === 0) return { distributed: 0, byUser: {} };

    // PASO 1: Obtener usuarios activos
    const activeUsers = await this.getActiveUsers();
    if (activeUsers.length === 0) throw new Error('No hay usuarios activos para distribuir');

    // PASO 2: Obtener carga actual
    const stats = await this.getCurrentWorkloadStats();

    // Crear mapa de carga mutable para simular la asignación en tiempo real
    const userLoad = activeUsers.map(u => {
      const stat = stats.find(s => s.user_id === u.id);
      return {
        id: u.id,
        email: u.email,
        load: stat ? (stat.tareas_activas || 0) : 0
      };
    });

    const assignments = [];
    const distributionSummary = {}; // email -> count

    // PASO 4: Distribuir usando algoritmo de "menor carga primero"
    for (const expId of expedienteIds) {
      // PASO 3 (Repetido): Ordenar usuarios por carga (de menor a mayor)
      userLoad.sort((a, b) => a.load - b.load);
      
      const targetUser = userLoad[0]; // Usuario con menor carga

      assignments.push({
        expediente_id: expId,
        user_id: targetUser.id,
        assigned_by: null, // System
        assignment_type: 'automatica_importacion',
        priority: 'Media',
        status: 'activa'
      });
      
      // Incrementar carga local para balancear el siguiente
      targetUser.load++;
      
      // Actualizar resumen
      distributionSummary[targetUser.email] = (distributionSummary[targetUser.email] || 0) + 1;
    }

    // Ejecutar inserciones en workload_assignments
    if (assignments.length > 0) {
      const { error: assignError } = await supabaseAdmin
        .from('workload_assignments')
        .insert(assignments);
      
      if (assignError) throw assignError;

      // Actualizar expedientes (Agrupado por usuario para eficiencia)
      const updatesByUser = {};
      assignments.forEach(a => {
        if (!updatesByUser[a.user_id]) updatesByUser[a.user_id] = [];
        updatesByUser[a.user_id].push(a.expediente_id);
      });

      for (const [userId, expIds] of Object.entries(updatesByUser)) {
        await supabaseAdmin
          .from('expedientes')
          .update({ gestor_id: userId })
          .in('id', expIds);
      }
    }

    // PASO 5: Actualizar import_logs con detalle de distribución
    if (importLogId) {
      await supabaseAdmin
        .from('import_logs')
        .update({
          distribution_details: distributionSummary
        })
        .eq('id', importLogId);
    }

    return { distributed: assignments.length, byUser: distributionSummary };
  }

  /**
   * FUNCIÓN 8: rebalanceWorkload()
   * Propósito: Rebalancear manualmente la carga completa entre todos los usuarios
   * Retorna: Objeto con resumen {tasksMoved: X, newDistribution: {...}}
   */
  static async rebalanceWorkload() {
    // PASO 1: Obtener usuarios activos
    const activeUsers = await this.getActiveUsers();
    if (activeUsers.length === 0) return { tasksMoved: 0, newDistribution: {} };

    // PASO 2: Obtener TODAS las tareas activas
    const { data: allTasks, error } = await supabaseAdmin
      .from('workload_assignments')
      .select('id, user_id, expediente_id')
      .eq('status', 'activa');

    if (error) throw error;
    if (!allTasks || allTasks.length === 0) return { tasksMoved: 0, newDistribution: {} };

    // PASO 3: Calcular cuántas tareas debe tener cada usuario
    const totalTasks = allTasks.length;
    const tasksPerUser = Math.floor(totalTasks / activeUsers.length);
    const remainder = totalTasks % activeUsers.length;

    // Agrupar tareas por usuario actual
    const userTasksMap = {};
    activeUsers.forEach(u => userTasksMap[u.id] = []);
    
    const unassignedTasks = []; // Tareas de usuarios inactivos o que ya no están en la lista

    allTasks.forEach(task => {
      if (userTasksMap[task.user_id]) {
        userTasksMap[task.user_id].push(task);
      } else {
        unassignedTasks.push(task);
      }
    });

    // PASO 4: Redistribuir
    const surplusTasks = [...unassignedTasks];
    const deficitUsers = [];

    // Determinar objetivo para cada usuario
    const targetCounts = {};
    activeUsers.forEach((u, index) => {
      // Repartir el resto entre los primeros usuarios para ser exactos
      targetCounts[u.id] = tasksPerUser + (index < remainder ? 1 : 0);
    });

    // Recolectar excedentes
    activeUsers.forEach(u => {
      const currentTasks = userTasksMap[u.id];
      const target = targetCounts[u.id];
      
      if (currentTasks.length > target) {
        // Tomar exceso (desde el final para mover las últimas asignadas)
        const excess = currentTasks.length - target;
        for (let i = 0; i < excess; i++) {
          surplusTasks.push(currentTasks.pop());
        }
      } else if (currentTasks.length < target) {
        deficitUsers.push({ id: u.id, needed: target - currentTasks.length });
      }
    });

    // Asignar excedentes a usuarios con déficit
    const updates = [];
    const distributionSummary = {};
    
    // Inicializar resumen con lo que se quedan
    activeUsers.forEach(u => {
        distributionSummary[u.email] = userTasksMap[u.id].length;
    });

    let surplusIndex = 0;
    
    for (const deficitUser of deficitUsers) {
      for (let i = 0; i < deficitUser.needed; i++) {
        if (surplusIndex < surplusTasks.length) {
          const task = surplusTasks[surplusIndex++];
          
          updates.push({
            assignment_id: task.id,
            expediente_id: task.expediente_id,
            new_user_id: deficitUser.id
          });

          // Actualizar resumen
          const user = activeUsers.find(u => u.id === deficitUser.id);
          if (user) distributionSummary[user.email]++;
        }
      }
    }

    // PASO 5: UPDATE masivo (Agrupado por usuario destino para eficiencia)
    if (updates.length > 0) {
      const updatesByUser = {};
      updates.forEach(u => {
        if (!updatesByUser[u.new_user_id]) updatesByUser[u.new_user_id] = { assignmentIds: [], expedienteIds: [] };
        updatesByUser[u.new_user_id].assignmentIds.push(u.assignment_id);
        updatesByUser[u.new_user_id].expedienteIds.push(u.expediente_id);
      });

      for (const [userId, data] of Object.entries(updatesByUser)) {
        // Actualizar assignments
        await supabaseAdmin
          .from('workload_assignments')
          .update({
            user_id: userId,
            assignment_type: 'rebalanceo_manual',
            assigned_by: null,
            assigned_at: new Date().toISOString()
          })
          .in('id', data.assignmentIds);

        // Sincronizar expedientes
        await supabaseAdmin
          .from('expedientes')
          .update({ gestor_id: userId })
          .in('id', data.expedienteIds);
      }
      
      // Registrar en historial
      await supabaseAdmin
        .from('workload_history')
        .insert({
          action: 'rebalanceo_manual_completo',
          details: { tasksMoved: updates.length, newDistribution: distributionSummary },
          created_at: new Date().toISOString()
        });
    }

    // Calcular notificaciones (agrupar por usuario destino)
    const movesByUser = {};
    updates.forEach(u => {
        movesByUser[u.new_user_id] = (movesByUser[u.new_user_id] || 0) + 1;
    });
    
    const notifications = activeUsers
        .filter(u => movesByUser[u.id])
        .map(u => ({ email: u.email, count: movesByUser[u.id] }));

    return { tasksMoved: updates.length, newDistribution: distributionSummary, notifications };
  }

  // Alias para compatibilidad con server.js
  static async getCurrentWorkload() {
    return this.getCurrentWorkloadStats();
  }
}
