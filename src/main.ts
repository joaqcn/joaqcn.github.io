import './style.css'
import { initCosmos } from './scene/cosmos'

const stops = Array.from(document.querySelectorAll<HTMLElement>('[data-stop]'))
const bar = document.getElementById('progress-bar') as HTMLElement
let keys: number[] = []

/** Scroll position (viewport centre) at which each section's waypoint is reached. */
function measure() {
  const vh = window.innerHeight
  keys = stops.map((s) => {
    const r = s.getBoundingClientRect()
    return r.top + window.scrollY + Math.min(r.height, vh) / 2
  })
}

/** Maps scroll position to 0..1 along the camera path, one waypoint per section. */
function getProgress(): number {
  const y = window.scrollY + window.innerHeight / 2
  const last = keys.length - 1
  if (y <= keys[0]) return 0
  if (y >= keys[last]) return 1
  let i = last - 1
  while (i > 0 && keys[i] > y) i--
  return (i + (y - keys[i]) / (keys[i + 1] - keys[i])) / last
}

measure()
window.addEventListener('resize', measure)
window.addEventListener('load', measure)

const cosmos = initCosmos(document.getElementById('cosmos') as HTMLElement, getProgress)
if (!cosmos) document.documentElement.classList.add('no-webgl')

// scroll progress bar
const updateBar = () => {
  const max = document.documentElement.scrollHeight - window.innerHeight
  bar.style.transform = `scaleX(${max > 0 ? window.scrollY / max : 0})`
}
window.addEventListener('scroll', updateBar, { passive: true })
updateBar()

// active nav link
const links = new Map(
  Array.from(document.querySelectorAll<HTMLAnchorElement>('[data-nav]')).map((a) => [a.dataset.nav!, a]),
)
const navObserver = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue
      links.forEach((a, id) => a.classList.toggle('active', id === e.target.id))
    }
  },
  { rootMargin: '-45% 0px -45% 0px' },
)
stops.forEach((s) => navObserver.observe(s))

// reveal-on-scroll + count-up stats
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
const revealTargets = document.querySelectorAll<HTMLElement>(
  '.eyebrow, h1, h2, .lead, .cta, .panel, .stats li, .hint',
)
revealTargets.forEach((el, i) => {
  el.classList.add('reveal')
  el.style.transitionDelay = `${(i % 4) * 70}ms`
})

function countUp(el: HTMLElement) {
  const end = Number(el.dataset.count)
  const suffix = el.dataset.suffix ?? ''
  if (!end || reduceMotion) return
  const start = performance.now()
  const step = (now: number) => {
    const p = Math.min(1, (now - start) / 1200)
    const eased = 1 - Math.pow(1 - p, 3)
    el.textContent = `${Math.round(end * eased).toLocaleString('en-US')}${suffix}`
    if (p < 1) requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}

const revealObserver = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue
      const el = e.target as HTMLElement
      el.classList.add('in')
      el.querySelectorAll<HTMLElement>('[data-count]').forEach(countUp)
      revealObserver.unobserve(el)
    }
  },
  { threshold: 0.15 },
)
revealTargets.forEach((el) => revealObserver.observe(el))

document.getElementById('year')!.textContent = String(new Date().getFullYear())
