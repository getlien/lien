<template>
  <div ref="containerRef" class="floating-logos-bg">
    <div
      v-for="(logo, index) in logos"
      :key="index"
      class="floating-logo"
      :style="{
        left: `${logo.x}%`,
        top: `${logo.y}%`,
        transform: logo.isHovered ? 'translate(-50%, -50%) scale(1.3) translateY(-10px)' : 'translate(-50%, -50%)'
      }"
      @mouseenter="handleHover(index)"
      @mouseleave="handleLeave(index)"
      :class="{ 'is-hovered': logo.isHovered }"
    >
      <img class="logo-icon" :src="logo.icon" :alt="logo.name" />
      <span class="logo-name">{{ logo.name }}</span>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'

const containerRef = ref(null)
const animationFrame = ref(null)

const logos = ref([
  // Row 1 - Top languages & tools
  { icon: 'https://cdn.simpleicons.org/typescript/3178C6', name: 'TypeScript', x: 8, y: 15, vx: 0.08, vy: 0.06, isHovered: false },
  { icon: 'https://cdn.simpleicons.org/javascript/F7DF1E', name: 'JavaScript', x: 22, y: 12, vx: -0.06, vy: 0.09, isHovered: false },
  { icon: 'https://cdn.simpleicons.org/vuedotjs/4FC08D', name: 'Vue', x: 38, y: 14, vx: -0.08, vy: -0.06, isHovered: false },
  { icon: 'https://cdn.simpleicons.org/python/3776AB', name: 'Python', x: 52, y: 16, vx: 0.06, vy: 0.08, isHovered: false },
  { icon: 'https://cdn.simpleicons.org/php/777BB4', name: 'PHP', x: 68, y: 13, vx: -0.09, vy: 0.06, isHovered: false },
  { icon: 'https://cdn.simpleicons.org/laravel/FF2D20', name: 'Laravel', x: 82, y: 17, vx: 0.08, vy: -0.09, isHovered: false },
  { icon: 'https://cursor.sh/brand/icon.svg', name: 'Cursor', x: 92, y: 14, vx: -0.07, vy: 0.08, isHovered: false },
  
  // Row 2 - Middle
  { icon: 'https://cdn.simpleicons.org/rust/000000', name: 'Rust', x: 12, y: 38, vx: 0.09, vy: -0.06, isHovered: false },
  { icon: 'https://cdn.simpleicons.org/go/00ADD8', name: 'Go', x: 28, y: 35, vx: -0.08, vy: 0.08, isHovered: false },
  { icon: 'https://cdn.simpleicons.org/openjdk/437291', name: 'Java', x: 45, y: 40, vx: 0.06, vy: 0.09, isHovered: false },
  { icon: 'https://cdn.simpleicons.org/ruby/CC342D', name: 'Ruby', x: 62, y: 37, vx: -0.09, vy: -0.08, isHovered: false },
  { icon: 'https://cdn.simpleicons.org/swift/F05138', name: 'Swift', x: 78, y: 39, vx: 0.08, vy: 0.06, isHovered: false },
  
  // Row 3 - Bottom
  { icon: 'https://cdn.simpleicons.org/cplusplus/00599C', name: 'C/C++', x: 15, y: 65, vx: -0.06, vy: -0.09, isHovered: false },
  { icon: 'https://cdn.simpleicons.org/kotlin/7F52FF', name: 'Kotlin', x: 32, y: 68, vx: 0.09, vy: 0.08, isHovered: false },
  { icon: 'https://cdn.simpleicons.org/dotnet/512BD4', name: 'C#', x: 50, y: 63, vx: -0.08, vy: 0.06, isHovered: false },
  { icon: 'https://cdn.simpleicons.org/scala/DC322F', name: 'Scala', x: 70, y: 67, vx: 0.06, vy: -0.08, isHovered: false },
  { icon: 'https://cdn.simpleicons.org/markdown/000000', name: 'Markdown', x: 88, y: 65, vx: -0.09, vy: 0.09, isHovered: false },
])

const handleHover = (index) => {
  const logo = logos.value[index]
  logo.isHovered = true
  // Store velocity for when hover ends
  logo.storedVx = logo.vx
  logo.storedVy = logo.vy
}

const handleLeave = (index) => {
  const logo = logos.value[index]
  logo.isHovered = false
  // Restore velocity (with a small boost for fun)
  if (logo.storedVx !== undefined) {
    logo.vx = logo.storedVx * 1.1
    logo.vy = logo.storedVy * 1.1
  }
}

// Collision detection between two logos
const checkCollision = (logo1, logo2) => {
  const dx = logo1.x - logo2.x
  const dy = logo1.y - logo2.y
  const distance = Math.sqrt(dx * dx + dy * dy)
  const minDistance = 8 // Minimum distance between logos (in %)
  
  return distance < minDistance
}

// Handle collision response
const handleCollision = (logo1, logo2) => {
  const dx = logo1.x - logo2.x
  const dy = logo1.y - logo2.y
  const distance = Math.sqrt(dx * dx + dy * dy)
  
  if (distance === 0) return // Avoid division by zero
  
  // Normalize the collision vector
  const nx = dx / distance
  const ny = dy / distance
  
  // Relative velocity
  const dvx = logo1.vx - logo2.vx
  const dvy = logo1.vy - logo2.vy
  
  // Relative velocity in collision normal direction
  const dvn = dvx * nx + dvy * ny
  
  // Don't process if velocities are separating
  if (dvn > 0) return
  
  // Collision impulse (elastic collision)
  const impulse = 2 * dvn / 2 // Divided by 2 for equal mass
  
  // Update velocities
  logo1.vx -= impulse * nx
  logo1.vy -= impulse * ny
  logo2.vx += impulse * nx
  logo2.vy += impulse * ny
  
  // Separate logos to avoid overlap
  const overlap = 8 - distance
  const separationX = (overlap / 2) * nx
  const separationY = (overlap / 2) * ny
  
  logo1.x += separationX
  logo1.y += separationY
  logo2.x -= separationX
  logo2.y -= separationY
}

// Animation loop
const animate = () => {
  logos.value.forEach((logo, i) => {
    // Hovered logos don't move but keep their velocity
    if (logo.isHovered) {
      return
    }
    
    // Apply gentle damping to gradually slow down (but not stop)
    const damping = 0.998 // Very subtle - keeps movement alive
    logo.vx *= damping
    logo.vy *= damping
    
    // Cap maximum velocity to prevent runaway speed
    const maxVelocity = 0.15
    const speed = Math.sqrt(logo.vx * logo.vx + logo.vy * logo.vy)
    if (speed > maxVelocity) {
      logo.vx = (logo.vx / speed) * maxVelocity
      logo.vy = (logo.vy / speed) * maxVelocity
    }
    
    // Maintain minimum velocity to prevent near-stop
    const minVelocity = 0.05
    if (speed < minVelocity && speed > 0) {
      logo.vx = (logo.vx / speed) * minVelocity
      logo.vy = (logo.vy / speed) * minVelocity
    }
    
    // Update position
    logo.x += logo.vx
    logo.y += logo.vy
    
    // Bounce off walls
    if (logo.x < 2 || logo.x > 98) {
      logo.vx *= -1
      logo.x = Math.max(2, Math.min(98, logo.x))
    }
    if (logo.y < 2 || logo.y > 98) {
      logo.vy *= -1
      logo.y = Math.max(2, Math.min(98, logo.y))
    }
    
    // Check collisions with other logos
    for (let j = i + 1; j < logos.value.length; j++) {
      const otherLogo = logos.value[j]
      if (!otherLogo.isHovered && checkCollision(logo, otherLogo)) {
        handleCollision(logo, otherLogo)
      }
    }
  })
  
  animationFrame.value = requestAnimationFrame(animate)
}

onMounted(() => {
  animate()
})

onUnmounted(() => {
  if (animationFrame.value) {
    cancelAnimationFrame(animationFrame.value)
  }
})
</script>

<style scoped>
.floating-logos-bg {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 0;
  pointer-events: none;
  overflow: hidden;
}

.floating-logo {
  position: absolute;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  pointer-events: auto;
  cursor: pointer;
  opacity: 0.25;
  transition: opacity 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  user-select: none;
  /* Much larger hover area - easier to catch */
  padding: 50px;
  margin: -50px;
  will-change: transform;
}

.logo-icon {
  width: 2.5rem;
  height: 2.5rem;
  filter: grayscale(0.8) opacity(0.7);
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  object-fit: contain;
}

.logo-name {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--vp-c-text-2);
  opacity: 0;
  transform: translateY(-5px);
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  white-space: nowrap;
}

/* Hover effects */
.floating-logo:hover,
.floating-logo.is-hovered {
  opacity: 1;
  z-index: 10;
}

.floating-logo:hover .logo-icon,
.floating-logo.is-hovered .logo-icon {
  filter: grayscale(0) drop-shadow(0 0 20px rgba(99, 102, 241, 0.6));
  width: 3.5rem;
  height: 3.5rem;
}

.dark .floating-logo:hover .logo-icon,
.dark .floating-logo.is-hovered .logo-icon {
  filter: grayscale(0) drop-shadow(0 0 25px rgba(74, 158, 255, 0.7));
}

.floating-logo:hover .logo-name,
.floating-logo.is-hovered .logo-name {
  opacity: 1;
  transform: translateY(0);
}

/* Pulse animation on hover */
.floating-logo:hover::before,
.floating-logo.is-hovered::before {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 80px;
  height: 80px;
  background: radial-gradient(circle, rgba(99, 102, 241, 0.2), transparent 70%);
  border-radius: 50%;
  animation: pulse 1.5s ease-out infinite;
  pointer-events: none;
}

.dark .floating-logo:hover::before,
.dark .floating-logo.is-hovered::before {
  background: radial-gradient(circle, rgba(74, 158, 255, 0.2), transparent 70%);
}

@keyframes pulse {
  0% {
    transform: translate(-50%, -50%) scale(0.8);
    opacity: 1;
  }
  100% {
    transform: translate(-50%, -50%) scale(1.5);
    opacity: 0;
  }
}

/* Mobile optimization */
@media (max-width: 768px) {
  .floating-logo {
    opacity: 0.15;
  }
  
  .logo-icon {
    width: 1.8rem;
    height: 1.8rem;
  }
  
  .floating-logo.is-hovered .logo-icon {
    width: 2.5rem;
    height: 2.5rem;
  }
}

/* Reduce motion for accessibility */
@media (prefers-reduced-motion: reduce) {
  .floating-logo {
    opacity: 0.4;
  }
}
</style>
