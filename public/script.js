async function searchExpedients() {
  console.log('Función searchExpedients llamada');
  
  const expediente = document.getElementById('searchExpedient').value;
  const poliza = document.getElementById('searchPolicy').value;
  const sgr = document.getElementById('searchSGR').value;
  const dni = document.getElementById('searchDNI').value;
  
  if (!expediente && !poliza && !sgr && !dni) {
    showToast('warning', 'Campos vacíos', 'Por favor ingresa al menos un criterio de búsqueda.');
    return;
  }
  
  showLoading();
  
  try {
    const params = new URLSearchParams();
    if (expediente) params.append('expediente', expediente);
    if (poliza) params.append('poliza', poliza);
    if (sgr) params.append('sgr', sgr);
    if (dni) params.append('dni', dni);
    
    const response = await fetch(`/api/expedientes/buscar?${params.toString()}`);
    
    if (!response.ok) {
      throw new Error('Error en la búsqueda');
    }
    
    const resultados = await response.json();
    
    // Mostrar resultados
    const resultsDiv = document.getElementById('searchResults');
    if (resultsDiv) {
      if (resultados.length === 0) {
        resultsDiv.innerHTML = '<div class="alert alert-info">No se encontraron expedientes con los criterios especificados.</div>';
      } else {
        let html = `<div class="alert alert-success">Se encontraron ${resultados.length} expediente(s)</div>`;
        html += '<div class="table-responsive"><table class="table table-striped"><thead><tr>';
        html += '<th>N° Expediente</th><th>Póliza</th><th>SGR</th><th>DNI</th><th>Estado</th><th>Acciones</th>';
        html += '</tr></thead><tbody>';
        
        resultados.forEach(exp => {
          html += `<tr>`;
          html += `<td>${exp.numero_expediente || 'N/A'}</td>`;
          html += `<td>${exp.numero_poliza || 'N/A'}</td>`;
          html += `<td>${exp.numero_sgr || 'N/A'}</td>`;
          html += `<td>${exp.dni || 'N/A'}</td>`;
          html += `<td><span class="badge badge-info">${exp.estado || 'N/A'}</span></td>`;
          html += `<td><button class="btn btn-sm btn-primary" onclick="viewExpedient('${exp.id}')">Ver</button></td>`;
          html += `</tr>`;
        });
        
        html += '</tbody></table></div>';
        resultsDiv.innerHTML = html;
      }
      resultsDiv.style.display = 'block';
    }
    
    showToast('success', 'Éxito', `Se encontraron ${resultados.length} expediente(s)`);
  } catch (error) {
    console.error('Error en búsqueda:', error);
    showToast('danger', 'Error', 'Error al buscar expedientes: ' + error.message);
  } finally {
    hideLoading();
  }
}

// ============================================================================
// FUNCIONES ADICIONALES PARA REPORTES Y ARCHIVADOS
// ============================================================================

// Generar reportes estadísticos
async function generateReport() {
  showLoading();
  try {
    const response = await fetch('/api/reportes/estadisticas');
    if (!response.ok) throw new Error('Error al generar reporte');
    
    const stats = await response.json();
    
    showToast('success', 'Reporte generado', `Total de expedientes: ${stats.total}`);
    console.log('Estadísticas:', stats);
    
    // Aquí puedes renderizar el reporte en el DOM
    return stats;
  } catch (error) {
    console.error('Error generando reporte:', error);
    showToast('danger', 'Error', 'Error al generar el reporte');
  } finally {
    hideLoading();
  }
}

// Buscar en archivados
async function searchArchive() {
  showLoading();
  try {
    const response = await fetch('/api/archivados?limite=100');
    if (!response.ok) throw new Error('Error al buscar archivados');
    
    const archivados = await response.json();
    
    showToast('success', 'Búsqueda completa', `Se encontraron ${archivados.length} expedientes archivados`);
    console.log('Archivados:', archivados);
    
    return archivados;
  } catch (error) {
    console.error('Error buscando archivados:', error);
    showToast('danger', 'Error', 'Error al buscar expedientes archivados');
  } finally {
    hideLoading();
  }
}

// Restaurar expediente archivado
async function restoreExpedient(id) {
  if (!confirm(`¿Está seguro de que desea restaurar el expediente ${id}?`)) {
    return;
  }
  
  showLoading();
  try {
    const response = await fetch(`/api/archivados/${id}/restaurar`, {
      method: 'POST'
    });
    
    if (!response.ok) throw new Error('Error al restaurar expediente');
    
    const result = await response.json();
    
    showToast('success', 'Restaurado', `El expediente ${id} ha sido restaurado correctamente`);
    
    // Recargar la lista de archivados
    searchArchive();
  } catch (error) {
    console.error('Error restaurando expediente:', error);
    showToast('danger', 'Error', 'Error al restaurar el expediente');
  } finally {
    hideLoading();
  }
}

// Visualizar expediente
function viewExpedient(id) {
  console.log('Visualizando expediente:', id);
  showToast('info', 'En desarrollo', `La vista detallada del expediente ${id} estará disponible próximamente.`);
}
