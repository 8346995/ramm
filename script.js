const GRID_SIZE = 32;
const MAX_POINTS = 8;
const gridEl = document.getElementById('grid');
const xLabelsEl = document.getElementById('x-labels');
const yLabelsEl = document.getElementById('y-labels');
const targetCoordEl = document.getElementById('coord-target');
const connectionsEl = document.getElementById('connections');

// Initialize SVG defs (filters and masks)
const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
defs.innerHTML = `
    <filter id="softGlow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur in="SourceGraphic" stdDeviation="2.5" result="blur" />
        <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
        </feMerge>
    </filter>
    <mask id="pulseMask">
        <circle id="maskCircle" r="15" fill="white" style="filter: blur(5px);" cx="-100" cy="-100" />
    </mask>
`;
connectionsEl.appendChild(defs);

let activePoints = []; // Stores {x, y, element, cx, cy, offset}
let currentTarget = { x: 0, y: 0 };
let animationFrameId = null;
let pulseStartTime = Date.now();
const PULSE_DURATION = 4000;
let currentEnergyPath = null;

function init() {
    createGrid();
    createLabels();
    setNewTarget();

    // Handle window resize for connections
    window.addEventListener('resize', updateConnections);
}

function createGrid() {
    gridEl.innerHTML = '';
    for (let y = GRID_SIZE - 1; y >= 0; y--) {
        for (let x = 0; x < GRID_SIZE; x++) {
            const cell = document.createElement('div');
            cell.className = 'cell';
            cell.textContent = '0';
            cell.dataset.x = x;
            cell.dataset.y = y;
            cell.onclick = () => handleCellClick(x, y, cell);
            gridEl.appendChild(cell);
        }
    }
}

function createLabels() {
    xLabelsEl.innerHTML = '';
    yLabelsEl.innerHTML = '';

    // X labels (Bottom axis)
    for (let i = 0; i < GRID_SIZE; i++) {
        const span = document.createElement('span');
        span.className = 'x-label';
        span.textContent = i.toString(2).padStart(5, '0');
        xLabelsEl.appendChild(span);
    }

    // Y labels (Left axis, bottom to top)
    for (let i = 0; i < GRID_SIZE; i++) {
        const span = document.createElement('span');
        span.className = 'y-label';
        span.textContent = i.toString(2).padStart(5, '0');
        yLabelsEl.appendChild(span);
    }
}

function setNewTarget() {
    // Remove previous target pulse
    const oldTarget = gridEl.querySelector('.cell.target');
    if (oldTarget) oldTarget.classList.remove('target');

    // Generate new random target not already active
    let nx, ny;
    do {
        nx = Math.floor(Math.random() * GRID_SIZE);
        ny = Math.floor(Math.random() * GRID_SIZE);
    } while (activePoints.some(p => p.x === nx && p.y === ny));

    currentTarget = { nx, ny }; // Wait, nx/ny was assigned to currentTarget.x/y before.
    currentTarget = { x: nx, y: ny };

    // Update Instruction text
    const bx = nx.toString(2).padStart(5, '0');
    const by = ny.toString(2).padStart(5, '0');
    targetCoordEl.textContent = `(${bx},${by})`;

    // Highlight cell
    const targetCell = gridEl.querySelector(`.cell[data-x="${nx}"][data-y="${ny}"]`);
    if (targetCell) targetCell.classList.add('target');
}

function handleCellClick(x, y, el) {
    if (x !== currentTarget.x || y !== currentTarget.y) return;

    el.classList.remove('target');
    el.classList.add('active');
    el.textContent = '1';

    activePoints.push({ x, y, element: el });

    if (activePoints.length > MAX_POINTS) {
        const oldest = activePoints.shift();
        oldest.element.classList.remove('active');
        oldest.element.textContent = '0';
    }

    updateConnections();
    setNewTarget();
}

function updateConnections() {
    // Clear paths but keep defs
    const paths = connectionsEl.querySelectorAll('.connection-path');
    paths.forEach(p => p.remove());

    if (activePoints.length < 2) return;

    let pathD = "";
    activePoints.forEach((point, index) => {
        const rect = point.element.getBoundingClientRect();
        const gridRect = gridEl.getBoundingClientRect();
        const cx = rect.left - gridRect.left + rect.width / 2;
        const cy = rect.top - gridRect.top + rect.height / 2;

        if (index === 0) pathD = `M ${cx} ${cy}`;
        else pathD += ` L ${cx} ${cy}`;
    });

    // 1. Thin base path
    const basePath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    basePath.setAttribute("d", pathD);
    basePath.setAttribute("class", "connection-path base");
    connectionsEl.appendChild(basePath);

    // 2. Thick energy path (masked)
    const energyPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    energyPath.setAttribute("d", pathD);
    energyPath.setAttribute("class", "connection-path energy");
    energyPath.setAttribute("mask", "url(#pulseMask)");
    connectionsEl.appendChild(energyPath);

    // 3. Update pulse state
    currentEnergyPath = energyPath;
    pulseStartTime = Date.now();

    // 4. Calculate point offsets for proximity detection
    const totalLength = energyPath.getTotalLength();
    let currentPathLength = 0;
    activePoints.forEach((point, index) => {
        const rect = point.element.getBoundingClientRect();
        const gridRect = gridEl.getBoundingClientRect();
        point.cx = rect.left - gridRect.left + rect.width / 2;
        point.cy = rect.top - gridRect.top + rect.height / 2;

        if (index === 0) {
            point.pixelOffset = 0;
        } else {
            const prev = activePoints[index - 1];
            const dist = Math.hypot(point.cx - prev.cx, point.cy - prev.cy);
            currentPathLength += dist;
            point.pixelOffset = currentPathLength;
        }
    });

    if (!animationFrameId) {
        animationFrameId = requestAnimationFrame(animatePulseReactions);
    }
}

function animatePulseReactions() {
    if (activePoints.length < 2 || !currentEnergyPath) {
        animationFrameId = null;
        activePoints.forEach(p => p.element.classList.remove('charging'));
        return;
    }

    const totalLength = currentEnergyPath.getTotalLength();
    const elapsed = (Date.now() - pulseStartTime) % PULSE_DURATION;
    const progress = elapsed / PULSE_DURATION;
    const currentLen = totalLength * progress;

    // Move the pulse mask manually
    const pulsePoint = currentEnergyPath.getPointAtLength(currentLen);
    const maskCircle = document.getElementById('maskCircle');
    if (maskCircle) {
        maskCircle.setAttribute('cx', pulsePoint.x);
        maskCircle.setAttribute('cy', pulsePoint.y);
    }

    const threshold = 30; // Pixel-based proximity threshold

    activePoints.forEach(point => {
        const dist = Math.abs(currentLen - point.pixelOffset);

        // Handle wrap-around for the last point if it's the start/end
        if (dist < threshold) {
            point.element.classList.add('charging');
        } else {
            point.element.classList.remove('charging');
        }
    });

    animationFrameId = requestAnimationFrame(animatePulseReactions);
}

init();
