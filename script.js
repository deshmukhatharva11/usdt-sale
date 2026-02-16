const canvas = document.getElementById('network');
const ctx = canvas.getContext('2d');
let width = 0;
let height = 0;
let points = [];
function resize() {
  const ratio = window.devicePixelRatio || 1;
  width = canvas.offsetWidth;
  height = canvas.offsetHeight;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  ctx.scale(ratio, ratio);
  points = Array.from({ length: 24 }).map(() => ({
    x: Math.random() * width,
    y: Math.random() * height,
    vx: (Math.random() - 0.5) * 0.3,
    vy: (Math.random() - 0.5) * 0.3
  }));
}
function step() {
  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = 'rgba(185, 246, 255, 0.35)';
  ctx.lineWidth = 1;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    p.x += p.vx;
    p.y += p.vy;
    if (p.x < 0 || p.x > width) p.vx *= -1;
    if (p.y < 0 || p.y > height) p.vy *= -1;
    for (let j = i + 1; j < points.length; j++) {
      const q = points[j];
      const dx = p.x - q.x;
      const dy = p.y - q.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 140) {
        ctx.globalAlpha = 1 - dist / 140;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(q.x, q.y);
        ctx.stroke();
      }
    }
  }
  ctx.globalAlpha = 1;
  for (const p of points) {
    ctx.fillStyle = 'rgba(185, 246, 255, 0.6)';
    ctx.beginPath();
    ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
    ctx.fill();
  }
  requestAnimationFrame(step);
}
window.addEventListener('resize', () => {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  resize();
});
resize();
step();
