'use strict';

// Stacked-bar chart helpers built on Chart.js.
const Charts = (() => {
  const COLORS = {
    completed: '#2e7d32',
    in_progress: '#e8833a',
    pending: '#15637e',
  };
  const LABELS = { completed: 'Completed', in_progress: 'In Progress', pending: 'Not completed' };

  let active = []; // track instances to destroy on re-render

  function destroyAll() {
    active.forEach((c) => { try { c.destroy(); } catch (_) {} });
    active = [];
  }

  /*
   * Render a stacked bar chart.
   *  canvas        : <canvas> element
   *  labels        : x-axis labels (e.g. company / month / staff names)
   *  series        : { completed: [..], in_progress: [..], pending: [..] }
   *  statuses      : which statuses to include, in stack order
   *  onSegment     : (labelIndex, status) => void  (click handler)
   */
  function stacked(canvas, labels, series, statuses, onSegment) {
    const datasets = statuses.map((st) => ({
      label: LABELS[st],
      data: series[st] || [],
      backgroundColor: COLORS[st],
      borderColor: '#fff',
      borderWidth: 1,
      borderRadius: 3,
      maxBarThickness: 78,
      _status: st,
    }));

    const chart = new Chart(canvas, {
      type: 'bar',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 500 },
        onClick: (evt, els) => {
          if (!onSegment || !els.length) return;
          const el = els[0];
          const status = datasets[el.datasetIndex]._status;
          onSegment(el.index, status);
        },
        onHover: (evt, els) => {
          if (onSegment) evt.native.target.style.cursor = els.length ? 'pointer' : 'default';
        },
        plugins: {
          legend: {
            position: 'bottom',
            labels: { usePointStyle: true, pointStyle: 'rectRounded', padding: 18, font: { size: 13, weight: '500' }, color: '#64748b' },
          },
          tooltip: {
            backgroundColor: '#0f2b38', padding: 12, cornerRadius: 8, titleFont: { size: 13 }, bodyFont: { size: 13 },
            callbacks: {
              footer: (items) => {
                const total = items.reduce((s, i) => s + i.parsed.y, 0);
                return `Total: ${total}`;
              },
            },
          },
        },
        scales: {
          x: { stacked: true, grid: { display: false }, ticks: { font: { size: 12.5, weight: '500' }, color: '#475569' } },
          y: { stacked: true, beginAtZero: true, ticks: { precision: 0, color: '#94a3b8' }, grid: { color: '#eef2f6' } },
        },
      },
    });
    active.push(chart);
    return chart;
  }

  return { stacked, destroyAll, COLORS, LABELS };
})();
