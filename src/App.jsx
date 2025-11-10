import { useCallback, useEffect, useRef, useState } from 'react'
import './App.css'

const DEFAULT_WIDTH = 1020
const DEFAULT_HEIGHT = 720
const MOBILE_BREAKPOINT_WIDTH = 900
const MOBILE_BREAKPOINT_HEIGHT = 600

const getViewportDimensions = () => ({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT })

const detectMobileViewport = () => {
  if (typeof window === 'undefined') return false
  const width = window.innerWidth
  const height = window.innerHeight
  const touchCapable =
    ('ontouchstart' in window) ||
    (window.navigator && 'maxTouchPoints' in window.navigator && window.navigator.maxTouchPoints > 0) ||
    (typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches)
  return (
    width <= MOBILE_BREAKPOINT_WIDTH ||
    height <= MOBILE_BREAKPOINT_HEIGHT ||
    (touchCapable && width < DEFAULT_WIDTH)
  )
}

const { width: FIELD_WIDTH, height: FIELD_HEIGHT } = getViewportDimensions()

const computeLanes = (height) => {
  const laneCount = 6
  const topMargin = 120
  const bottomMargin = height - 120
  if (laneCount === 1) return [height / 2]
  const step = (bottomMargin - topMargin) / (laneCount - 1)
  return Array.from({ length: laneCount }, (_, index) => topMargin + index * step)
}

const LANES = computeLanes(FIELD_HEIGHT)
const NUT_DAMAGE = 8
const NUT_SPEED_X = 500
const NUT_SPEED_Y = 200
const NUT_HOMING_WEIGHT = 2
const MATCH_DURATION = Infinity
const DEFAULT_MAX_ROBO = Number.POSITIVE_INFINITY
const DEFAULT_MAX_ROUNDS = 5
const computeWinsToClaim = (rounds) => Math.floor(rounds / 2) + 1

const KEY_LOOKUP = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  w: 'up',
  W: 'up',
  s: 'down',
  S: 'down',
  a: 'left',
  A: 'left',
  d: 'right',
  D: 'right',
  ' ': 'fire',
  j: 'fire',
  J: 'fire',
  r: 'deployRobo',
  R: 'deployRobo',
}

const uid = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
const lerp = (start, end, t) => start + (end - start) * t

const drawRoundedRect = (ctx, x, y, width, height, radius) => {
  const r = Math.min(radius, width / 2, height / 2)
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + width - r, y)
  ctx.quadraticCurveTo(x + width, y, x + width, y + r)
  ctx.lineTo(x + width, y + height - r)
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height)
  ctx.lineTo(x + r, y + height)
  ctx.quadraticCurveTo(x, y + height, x, y + height - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

class NutcrackerGame {
  constructor(canvas, options) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')
    this.playerSide = options.playerSide
    this.playerControl = 'player'
    this.config = options.config ?? {}
    this.onSnapshot = options.onSnapshot
    this.onMatchState = options.onMatchState
    this.restartKey = options.restartKey

    this.maxRounds = Math.max(1, this.config.maxRounds ?? DEFAULT_MAX_ROUNDS)
    this.winsToClaim = computeWinsToClaim(this.maxRounds)
    this.maxRobo = Math.max(0, this.config.maxRobo ?? DEFAULT_MAX_ROBO)
    this.unlimitedRobo = !Number.isFinite(this.maxRobo)
    this.roboSpawnBase = this.config.roboSpawnBase ?? 8
    this.roboSpawnSpacing = this.config.roboSpawnSpacing ?? 6
    this.roboEnabled = this.config.roboEnabled ?? this.maxRobo > 0

    this.entities = []
    this.projectiles = []
    this.effects = []
    this.obstacles = this.createObstacles()
    this.keys = {}
    this.running = false
    this.phase = 'running'
    this.phaseTime = 0
    this.phaseDuration = MATCH_DURATION
    this.totalElapsed = 0
    this.allowRobo = this.roboEnabled
    this.roboSchedule = this.roboEnabled ? this.generateRoboSchedule() : []
    this.roboSpawned = 0
    this.roboReady = 0
    this.snapshotTimer = 0
    this.frameRequest = null
    this.lastFrame = 0
    this.playerEntity = null
    this.winner = null
    this.reason = ''
    this.phase = 'running'
    this.round = 1
    this.manualWins = 0
    this.autonomyWins = 0
    this.champion = null
    this.matchFinished = false
    this.roboReady = 0
    this.roundCasualties = []
    this.currentRoundCasualties = this.createCasualtyRecord()

    this.setupCanvas()
    this.initTeams()
    this.handleKeyDown = this.handleKeyDown.bind(this)
    this.handleKeyUp = this.handleKeyUp.bind(this)
    window.addEventListener('keydown', this.handleKeyDown)
    window.addEventListener('keyup', this.handleKeyUp)
  }

  createCasualtyRecord() {
    return { manual: 0, autonomy: 0 }
  }

  recordCasualty(entity) {
    if (!entity || !entity.team) return
    const key = entity.team === 'manual' ? 'manual' : 'autonomy'
    if (this.currentRoundCasualties[key] == null) {
      this.currentRoundCasualties[key] = 0
    }
    this.currentRoundCasualties[key] += 1
  }

  setupCanvas() {
    const scale = window.devicePixelRatio || 1
    this.canvas.width = FIELD_WIDTH * scale
    this.canvas.height = FIELD_HEIGHT * scale
    this.canvas.style.width = '100%'
    this.canvas.style.maxWidth = `${FIELD_WIDTH}px`
    this.canvas.style.height = 'auto'
    this.canvas.style.display = 'block'
    this.canvas.style.margin = '0 auto'
    this.ctx.setTransform(scale, 0, 0, scale, 0, 0)
  }

  start() {
    this.running = true
    this.lastFrame = performance.now()
    this.loop(this.lastFrame)
    this.onMatchState?.({
      status: 'running',
      round: this.round,
      manualWins: this.manualWins,
      autonomyWins: this.autonomyWins,
    })
  }

  destroy() {
    this.running = false
    if (this.frameRequest) cancelAnimationFrame(this.frameRequest)
    window.removeEventListener('keydown', this.handleKeyDown)
    window.removeEventListener('keyup', this.handleKeyUp)
  }

  generateRoboSchedule() {
    if (this.maxRobo <= 0) return []
    const base = this.roboSpawnBase
    const spacing = this.roboSpawnSpacing
    const first = base + Math.random() * 3
    if (this.unlimitedRobo) {
      return [first]
    }
    return Array.from({ length: this.maxRobo }, (_, index) => first + index * spacing + Math.random() * 3)
  }

  createObstacles() {
    return []
  }

  getHalfBounds(team) {
    const margin = 100
    const midpoint = FIELD_WIDTH / 2
    if (team === 'manual') {
      return { minX: margin, maxX: midpoint - margin }
    }
    return { minX: midpoint + margin, maxX: FIELD_WIDTH - margin }
  }

  enforceHalfBoundary(entity) {
    if (!entity || entity.type === 'robo') return
    const { minX, maxX } = this.getHalfBounds(entity.team)
    entity.position.x = clamp(entity.position.x, minX, maxX)
  }

  resolveEntityObstacles(entity) {
    this.obstacles.forEach((obstacle) => {
      if (obstacle.type !== 'stump') return
      const dx = entity.position.x - obstacle.position.x
      const dy = entity.position.y - obstacle.position.y
      const dist = Math.hypot(dx, dy)
      const minDist = entity.radius + obstacle.radius
      if (dist === 0) {
        entity.position.x += minDist
      } else if (dist < minDist) {
        const push = minDist - dist
        entity.position.x += (dx / dist) * push
        entity.position.y += (dy / dist) * push
      }
    })
  }

  hitsObstacle(position, radius) {
    return this.obstacles.some((obstacle) => {
      if (obstacle.type !== 'stump') return false
      const dx = position.x - obstacle.position.x
      const dy = position.y - obstacle.position.y
      return Math.hypot(dx, dy) <= obstacle.radius + radius
    })
  }

  initTeams() {
    const manualTeam = []
    const autonomyTeam = []

    let manualAssigned = false
    let autonomyAssigned = false

    const createFighter = ({ team, laneIndex, offset, isPlayer }) => {
      const laneY = LANES[laneIndex]
      const xStart = team === 'manual' ? 160 : FIELD_WIDTH - 160
      const y = laneY + offset

      const fighter = {
        id: uid(),
        team,
        type: isPlayer ? 'commander' : 'bot',
        isPlayer,
        position: { x: xStart, y },
        radius: isPlayer ? 20 : 16,
        hp: 200,
        maxHp: 200,
        speed: isPlayer ? 160 : 130,
        nutCooldown: 0,
        aimTimer: 0,
        facing: team === 'manual' ? 1 : -1,
        color: team === 'manual' ? '#f97316' : '#38bdf8',
        alive: true,
        targetId: null,
        wanderTimer: Math.random() * 1.5,
        wanderTarget: null,
        noiseOffset: Math.random() * Math.PI * 2,
      }

      if (isPlayer) {
        fighter.speed = 200
        this.playerEntity = fighter
      }

      if (team === 'manual') manualTeam.push(fighter)
      else autonomyTeam.push(fighter)
    }

    LANES.forEach((_, index) => {
      const offsets = [-24, 22]
      offsets.forEach((offset) => {
        const shouldAssignPlayer = this.playerSide === 'manual' && !manualAssigned
        createFighter({ team: 'manual', laneIndex: index, offset, isPlayer: shouldAssignPlayer })
        manualAssigned = manualAssigned || shouldAssignPlayer
      })
    })

    LANES.forEach((_, index) => {
      const offsets = [-24, 22]
      offsets.forEach((offset) => {
        const shouldAssignPlayer = this.playerSide === 'autonomy' && !autonomyAssigned
        createFighter({ team: 'autonomy', laneIndex: index, offset, isPlayer: shouldAssignPlayer })
        autonomyAssigned = autonomyAssigned || shouldAssignPlayer
      })
    })

    this.entities = [...manualTeam, ...autonomyTeam]
  }

  handleKeyDown(event) {
    if (this.playerControl !== 'player') return
    const action = KEY_LOOKUP[event.key] ?? KEY_LOOKUP[event.code]
    if (!action) return
    if (action === 'deployRobo') {
      event.preventDefault()
      this.deployPlayerRobo()
      return
    }
    this.keys[action] = true
    if (['fire', 'left', 'right', 'up', 'down'].includes(action)) {
      event.preventDefault()
    }
  }

  handleKeyUp(event) {
    if (this.playerControl !== 'player') return
    const action = KEY_LOOKUP[event.key] ?? KEY_LOOKUP[event.code]
    if (!action) return
    this.keys[action] = false
  }

  loop(time) {
    if (!this.running) return
    const delta = clamp((time - this.lastFrame) / 1000, 0, 0.05)
    this.lastFrame = time
    this.update(delta)
    this.render()
    if (this.running) {
      this.frameRequest = requestAnimationFrame((next) => this.loop(next))
    }
  }

  update(delta) {
    if (!this.playerEntity || !this.playerEntity.alive) {
      // ensure we still send snapshots with cooldown display even if commander is out
    }

    this.phaseTime += delta
    this.totalElapsed += delta

    this.spawnScheduledRobo()
    this.updateEntities(delta)
    this.updateProjectiles(delta)
    this.updateEffects(delta)

    this.evaluateMatchState()
    this.snapshotTimer += delta
    if (this.snapshotTimer >= 0.15) {
      this.snapshotTimer = 0
      this.sendSnapshot()
    }
  }

  spawnScheduledRobo() {
    if (!this.allowRobo || !this.roboEnabled || this.phase !== 'running') return
    if (this.roboSpawned >= this.maxRobo) return
    const nextDeploy = this.roboSchedule[0]
    if (nextDeploy == null) return
    if (this.totalElapsed >= nextDeploy) {
      this.roboSchedule.shift()
      if (this.unlimitedRobo) {
        const nextTime = this.totalElapsed + this.roboSpawnSpacing + Math.random() * 3
        this.roboSchedule.push(nextTime)
      }
      if (this.playerSide === 'autonomy') {
        if (this.roboSpawned + this.roboReady < this.maxRobo) {
          this.roboReady += 1
          this.effects.push({
            id: uid(),
            type: 'robo-spawn',
            position: this.playerEntity
              ? { ...this.playerEntity.position }
              : { x: FIELD_WIDTH - 120, y: FIELD_HEIGHT / 2 },
            ttl: 1,
          })
        }
      } else {
        this.spawnRoboNut()
      }
    }
  }

  spawnRoboNut() {
    const lane = LANES[Math.floor(Math.random() * LANES.length)]
    const robo = {
      id: uid(),
      team: 'autonomy',
      type: 'robo',
      isPlayer: false,
      position: { x: FIELD_WIDTH - 120, y: lane + (Math.random() * 40 - 20) },
      radius: 13,
      hp: 60,
      maxHp:60,
      speed: 485,
      nutCooldown: 0,
      facing: -1,
      color: '#a855f7',
      alive: true,
    }
    this.entities.push(robo)
    this.effects.push({
      id: uid(),
      type: 'robo-spawn',
      position: { ...robo.position },
      ttl: 1.4,
    })
    this.roboSpawned += 1
  }

  deployPlayerRobo() {
    if (this.playerSide !== 'autonomy' || !this.roboEnabled) return
    if (this.roboReady <= 0 || this.roboSpawned >= this.maxRobo) return
    this.roboReady -= 1
    this.spawnRoboNut()
  }

  updateEntities(delta) {
    const player = this.playerEntity
    this.entities.forEach((entity) => {
      if (!entity.alive) return

      entity.nutCooldown = Math.max(0, entity.nutCooldown - delta)

      const effectiveSpeed = entity.speed
      const teamDirection = entity.team === 'manual' ? 1 : -1

      if (entity.type === 'robo') {
        this.updateRobo(entity, effectiveSpeed, delta)
        return
      }

      if (entity.isPlayer) {
        if (this.playerControl === 'player') {
        this.updatePlayer(entity, effectiveSpeed, delta)
        } else {
          this.updateBot(entity, effectiveSpeed, delta)
        }
      } else {
        this.updateBot(entity, effectiveSpeed, delta)
      }

      if (!entity.isPlayer) {
        const enemyFront = FIELD_WIDTH / 2 + teamDirection * -80
        entity.position.x = clamp(
          entity.position.x + teamDirection * 30 * delta,
          120,
          FIELD_WIDTH - 120
        )
        entity.position.x = lerp(entity.position.x, enemyFront, 0.08 * delta)
      }

      entity.position.x = clamp(entity.position.x, 80, FIELD_WIDTH - 80)
      entity.position.y = clamp(entity.position.y, 80, FIELD_HEIGHT - 80)
      this.resolveEntityObstacles(entity)
      this.enforceHalfBoundary(entity)
      entity.position.x = clamp(entity.position.x, 80, FIELD_WIDTH - 80)
      entity.position.y = clamp(entity.position.y, 80, FIELD_HEIGHT - 80)
    })

    if (player && !player.alive && this.keys.fire) {
      this.keys.fire = false
    }
  }

  updatePlayer(entity, speed, delta) {
    if (!entity.alive) return
    const move = { x: 0, y: 0 }
    if (this.keys.up) move.y -= 1
    if (this.keys.down) move.y += 1
    if (this.keys.left) move.x -= 1
    if (this.keys.right) move.x += 1
    const length = Math.hypot(move.x, move.y)
    if (length > 0) {
      move.x /= length
      move.y /= length
    }
    entity.position.x += move.x * speed * delta
    entity.position.y += move.y * speed * delta

    if (this.keys.fire && entity.nutCooldown === 0) {
      this.fireNut(entity)
    }

    this.enforceHalfBoundary(entity)
    entity.position.x = clamp(entity.position.x, 80, FIELD_WIDTH - 80)
    entity.position.y = clamp(entity.position.y, 80, FIELD_HEIGHT - 80)
  }

  updateBot(entity, speed, delta) {
    const opponents = this.entities.filter((e) => e.team !== entity.team && e.alive)
    if (opponents.length === 0) return
    const nearest = opponents.reduce((closest, current) => {
      if (!closest) return current
      return distance(entity.position, current.position) < distance(entity.position, closest.position)
        ? current
        : closest
    }, null)

    entity.wanderTimer = (entity.wanderTimer ?? 0) - delta
    const bounds = this.getHalfBounds(entity.team)
    if (!entity.wanderTarget || entity.wanderTimer <= 0) {
      entity.wanderTimer = 1.2 + Math.random() * 2
      entity.wanderTarget = {
        x: clamp(bounds.minX + Math.random() * (bounds.maxX - bounds.minX), bounds.minX, bounds.maxX),
        y: clamp(100 + Math.random() * (FIELD_HEIGHT - 200), 100, FIELD_HEIGHT - 100),
      }
    }

    const targetX = entity.team === 'manual' ? FIELD_WIDTH / 2 - 70 : FIELD_WIDTH / 2 + 70
    const targetY = nearest ? nearest.position.y : entity.position.y

    let desired = {
      x: targetX - entity.position.x,
      y: targetY - entity.position.y,
    }

    if (entity.wanderTarget) {
      desired.x += (entity.wanderTarget.x - entity.position.x) * 0.9
      desired.y += (entity.wanderTarget.y - entity.position.y) * 0.6
    }

    const allies = this.entities.filter(
      (ally) => ally.team === entity.team && ally.alive && ally.id !== entity.id
    )
    const separation = { x: 0, y: 0 }
    allies.forEach((ally) => {
      const dx = entity.position.x - ally.position.x
      const dy = entity.position.y - ally.position.y
      const dist = Math.hypot(dx, dy)
      const separationRadius = 180
      if (dist > 0 && dist < separationRadius) {
        const strength = (separationRadius - dist) / separationRadius
        separation.x += (dx / dist) * strength * 2.2
        separation.y += (dy / dist) * strength * 1.4
      }
    })
    if (Math.hypot(separation.x, separation.y) > 0.001) {
      desired.x += separation.x * 180
      desired.y += separation.y * 120
    }

    const threats = this.projectiles.filter((projectile) => projectile.team !== entity.team)
    const dodge = { x: 0, y: 0 }
    threats.forEach((projectile) => {
      const offset = {
        x: entity.position.x - projectile.position.x,
        y: entity.position.y - projectile.position.y,
      }
      const dist = Math.hypot(offset.x, offset.y)
      if (dist === 0 || dist > 170) return
      const projDir = {
        x: projectile.velocity.x,
        y: projectile.velocity.y,
      }
      const projSpeed = Math.hypot(projDir.x, projDir.y) || 1
      projDir.x /= projSpeed
      projDir.y /= projSpeed
      const toward = offset.x * projDir.x + offset.y * projDir.y
      if (toward <= 0) return
      const perpendicular = { x: -projDir.y, y: projDir.x }
      const orientation = perpendicular.x * offset.x + perpendicular.y * offset.y
      const sign = orientation === 0 ? (Math.random() > 0.5 ? 1 : -1) : Math.sign(orientation)
      dodge.x += perpendicular.x * sign * (1 / Math.max(dist, 40))
      dodge.y += perpendicular.y * sign * (1 / Math.max(dist, 40))
    })

    if (Math.hypot(dodge.x, dodge.y) > 0.001) {
      desired.x += dodge.x * 240
      desired.y += dodge.y * 240
    }

    if (nearest) {
      const diff = {
        x: entity.position.x - nearest.position.x,
        y: entity.position.y - nearest.position.y,
      }
      const dist = Math.hypot(diff.x, diff.y) || 1
      if (dist < 120) {
        desired.x += (diff.x / dist) * 220
        desired.y += (diff.y / dist) * 160
      }
    }

    const jitterY =
      Math.sin(this.totalElapsed * 1.2 + entity.noiseOffset + entity.position.y * 0.018) * 0.8
    const jitterX = Math.cos(this.totalElapsed * 0.9 + entity.noiseOffset) * 0.7
    desired.y += jitterY
    desired.x += jitterX * 200

    const desiredLength = Math.hypot(desired.x, desired.y)
    if (desiredLength > 0) {
      desired.x /= desiredLength
      desired.y /= desiredLength
    }

    entity.position.x += desired.x * speed * delta
    entity.position.y += desired.y * speed * delta

    if (nearest && entity.nutCooldown === 0) {
      const dist = distance(entity.position, nearest.position)
      if (dist <= 520) {
        const closeBonus = dist < 220 ? 4.5 : dist < 360 ? 2.5 : 0
        const fireChance = 5.5 + closeBonus
        if (Math.random() < delta * fireChance) {
          this.fireNut(entity, nearest)
        }
      }
    }
  }

  updateRobo(entity, speed, delta) {
    if (!entity.alive) return
    const opponents = this.entities.filter((e) => e.team !== entity.team && e.alive)
    if (opponents.length === 0) return
    const nearest = opponents.reduce((closest, current) => {
      if (!closest) return current
      return distance(entity.position, current.position) < distance(entity.position, closest.position)
        ? current
        : closest
    }, null)
    if (!nearest) return
    const dir = {
      x: nearest.position.x - entity.position.x,
      y: nearest.position.y - entity.position.y,
    }
    const len = Math.hypot(dir.x, dir.y)
    if (len > 0) {
      dir.x /= len
      dir.y /= len
    }
    entity.position.x += dir.x * speed * delta
    entity.position.y += dir.y * speed * delta

    if (distance(entity.position, nearest.position) < entity.radius + nearest.radius + 4) {
      if (nearest.alive) {
      nearest.hp = 0
      nearest.alive = false
        this.recordCasualty(nearest)
      }
      this.effects.push({
        id: uid(),
        type: 'confetti',
        position: { ...nearest.position },
        ttl: 1.5,
        color: nearest.team === 'manual' ? '#f97316' : '#38bdf8',
      })
      this.effects.push({
        id: uid(),
        type: 'ko-honk',
        position: { ...nearest.position },
        ttl: 1,
      })
    }

    entity.position.x = clamp(entity.position.x, 80, FIELD_WIDTH - 80)
    entity.position.y = clamp(entity.position.y, 80, FIELD_HEIGHT - 80)
    this.resolveEntityObstacles(entity)
    entity.position.x = clamp(entity.position.x, 80, FIELD_WIDTH - 80)
    entity.position.y = clamp(entity.position.y, 80, FIELD_HEIGHT - 80)
  }

  fireNut(shooter, preferredTarget) {
    const opponents = this.entities.filter((e) => e.team !== shooter.team && e.alive)
    if (opponents.length === 0) return
    const target =
      preferredTarget ??
      opponents.reduce((closest, current) => {
        if (!closest) return current
        return distance(shooter.position, current.position) < distance(shooter.position, closest.position)
          ? current
          : closest
      }, null)
    if (!target) return

    const direction = {
      x: target.position.x - shooter.position.x,
      y: target.position.y - shooter.position.y,
    }
    const length = Math.hypot(direction.x, direction.y) || 1
    direction.x /= length
    direction.y /= length

    this.projectiles.push({
      id: uid(),
      ownerId: shooter.id,
      team: shooter.team,
      position: { x: shooter.position.x, y: shooter.position.y },
      velocity: { x: direction.x * NUT_SPEED_X, y: direction.y * NUT_SPEED_Y },
      targetId: target.id,
      radius: 6,
      damage: NUT_DAMAGE,
      ttl: 2.6,
      color: shooter.team === 'manual' ? '#fb923c' : '#38bdf8',
    })

    shooter.nutCooldown = 0.2
    this.effects.push({
      id: uid(),
      type: 'muzzle',
      position: { ...shooter.position },
      ttl: 0.25,
      color: shooter.team === 'manual' ? '#fde68a' : '#bae6fd',
    })
  }

  updateProjectiles(delta) {
    this.projectiles = this.projectiles.filter((projectile) => {
      projectile.ttl -= delta
      if (projectile.ttl <= 0) return false
      if (projectile.targetId) {
        const target = this.entities.find((entity) => entity.id === projectile.targetId && entity.alive)
        if (target) {
          const desiredDir = target.position.y - projectile.position.y
          const desiredLen = Math.abs(desiredDir)
          if (desiredLen > 0.0001) {
            const desiredVelocityY = (desiredDir / desiredLen) * NUT_SPEED_Y
            const homingStrength = Math.min(1, NUT_HOMING_WEIGHT * delta)
            projectile.velocity.y = lerp(projectile.velocity.y, desiredVelocityY, homingStrength)
          }
        }
      }
      projectile.position.x += projectile.velocity.x * delta
      projectile.position.y += projectile.velocity.y * delta

      if (
        projectile.position.x < 40 ||
        projectile.position.x > FIELD_WIDTH - 40 ||
        projectile.position.y < 40 ||
        projectile.position.y > FIELD_HEIGHT - 40
      ) {
        return false
      }

      const targets = this.entities.filter((entity) => entity.team !== projectile.team && entity.alive)
      for (const target of targets) {
        if (distance(projectile.position, target.position) <= projectile.radius + target.radius) {
          target.hp -= projectile.damage
          this.effects.push({
            id: uid(),
            type: 'hit',
            position: { ...target.position },
            ttl: 0.4,
            color: projectile.color,
          })
          if (target.type === 'robo') {
            target.hp = Math.max(0, target.hp)
          }
          if (target.hp <= 0) {
            if (target.alive) {
            target.alive = false
              this.recordCasualty(target)
            }
            this.effects.push({
              id: uid(),
              type: 'confetti',
              position: { ...target.position },
              ttl: 1.2,
              color: target.team === 'manual' ? '#f97316' : '#38bdf8',
            })
          }
          return false
        }
      }

      return true
    })
  }

  updateEffects(delta) {
    this.effects = this.effects.filter((effect) => {
      effect.ttl -= delta
      return effect.ttl > 0
    })
  }

  evaluateMatchState() {
    if (this.phase !== 'running') return
    const manualAlive = this.entities.filter((e) => e.team === 'manual' && e.alive)
    const autonomyAlive = this.entities.filter((e) => e.team === 'autonomy' && e.alive)

    if (manualAlive.length === 0 || autonomyAlive.length === 0) {
      const winner = manualAlive.length > 0 ? 'manual' : autonomyAlive.length > 0 ? 'autonomy' : 'draw'
      this.finishMatch(winner, 'elimination')
    }
  }

  finishMatch(winner, reason) {
    if (!this.running) return
    this.running = false
    this.phase = 'intermission'
    this.winner = winner
    this.reason = reason

    const completedRound = this.round
    if (winner === 'manual') {
      this.manualWins += 1
    } else if (winner === 'autonomy') {
      this.autonomyWins += 1
    }

    const roundReport = { ...this.currentRoundCasualties }
    this.roundCasualties.push(roundReport)
    const casualtyTotals = this.roundCasualties.reduce((acc, entry) => {
      acc.manual += entry.manual ?? 0
      acc.autonomy += entry.autonomy ?? 0
      return acc
    }, this.createCasualtyRecord())
    const casualtyPayload = {
      latestRound: roundReport,
      totals: { ...casualtyTotals },
      rounds: this.roundCasualties.map((entry) => ({ ...entry })),
    }

    const matchOver =
      this.manualWins >= this.winsToClaim ||
      this.autonomyWins >= this.winsToClaim ||
      completedRound >= this.maxRounds

    if (matchOver) {
      this.champion =
        this.manualWins > this.autonomyWins
          ? 'manual'
          : this.autonomyWins > this.manualWins
          ? 'autonomy'
          : 'draw'
      this.phase = 'champion'
      this.matchFinished = true
    }

    this.sendSnapshot()
    this.onMatchState?.({
      status: matchOver ? 'match-finished' : 'round-finished',
      winner,
      reason,
      round: completedRound,
      manualWins: this.manualWins,
      autonomyWins: this.autonomyWins,
      champion: matchOver ? this.champion : null,
      totalElapsed: this.totalElapsed,
      manualRemaining: this.entities
        .filter((e) => e.team === 'manual' && e.alive)
        .reduce((sum, e) => sum + e.hp, 0),
      autonomyRemaining: this.entities
        .filter((e) => e.team === 'autonomy' && e.alive)
        .reduce((sum, e) => sum + e.hp, 0),
      casualties: casualtyPayload,
    })

    if (!matchOver) {
      this.currentRoundCasualties = this.createCasualtyRecord()
      this.phase = 'intermission'
      setTimeout(() => this.startNextRound(), 1800)
    }
  }

  startNextRound() {
    if (this.matchFinished) return
    this.round = Math.min(this.round + 1, this.maxRounds)
    this.phase = 'running'
    this.phaseTime = 0
    this.phaseDuration = MATCH_DURATION
    this.totalElapsed = 0
    this.allowRobo = this.roboEnabled
    this.roboSchedule = this.roboEnabled ? this.generateRoboSchedule() : []
    this.roboSpawned = 0
    this.roboReady = 0
    this.winner = null
    this.reason = ''
    this.projectiles = []
    this.effects = []
    this.obstacles = this.createObstacles()
    this.playerEntity = null
    this.currentRoundCasualties = this.createCasualtyRecord()
    this.initTeams()
    this.running = true
    this.lastFrame = performance.now()
    this.loop(this.lastFrame)
    this.onMatchState?.({
      status: 'running',
      round: this.round,
      manualWins: this.manualWins,
      autonomyWins: this.autonomyWins,
    })
  }

  sendSnapshot() {
    const player = this.playerEntity
    const manualStats = this.entities.filter((e) => e.team === 'manual')
    const autonomyStats = this.entities.filter((e) => e.team === 'autonomy')
    const manualHp = manualStats.filter((e) => e.alive).reduce((sum, e) => sum + e.hp, 0)
    const autonomyHp = autonomyStats.filter((e) => e.alive).reduce((sum, e) => sum + e.hp, 0)

    this.onSnapshot?.({
      phase: this.phase,
      timeRemaining: Number.isFinite(this.phaseDuration)
        ? clamp(this.phaseDuration - this.phaseTime, 0, this.phaseDuration)
        : null,
      totalElapsed: this.totalElapsed,
      round: this.round,
      maxRounds: this.maxRounds,
      manualWins: this.manualWins,
      autonomyWins: this.autonomyWins,
      champion: this.champion,
      manual: {
        hp: manualHp,
        fighters: manualStats.map((fighter) => ({
          id: fighter.id,
          alive: fighter.alive,
          hp: Math.max(0, fighter.hp),
        })),
      },
      autonomy: {
        hp: autonomyHp,
        fighters: autonomyStats.map((fighter) => ({
          id: fighter.id,
          alive: fighter.alive,
          hp: Math.max(0, fighter.hp),
        })),
      },
      roboReady: this.roboReady,
      roboRemaining: Number.isFinite(this.maxRobo)
        ? Math.max(0, this.maxRobo - (this.roboSpawned + this.roboReady))
        : null,
      player: player
        ? {
            alive: player.alive,
            team: player.team,
            nutCooldown: player.nutCooldown,
            position: { ...player.position },
          }
        : null,
      winner: this.winner,
      reason: this.reason,
    })
  }

  render() {
    const ctx = this.ctx
    ctx.clearRect(0, 0, FIELD_WIDTH, FIELD_HEIGHT)

    // background
    const gradient = ctx.createLinearGradient(0, 0, 0, FIELD_HEIGHT)
    gradient.addColorStop(0, '#0b3d26')
    gradient.addColorStop(0.35, '#115e38')
    gradient.addColorStop(0.7, '#134e31')
    gradient.addColorStop(1, '#082c1d')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, FIELD_WIDTH, FIELD_HEIGHT)

    // arena markings
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)'
    ctx.lineWidth = 4
    ctx.setLineDash([12, 16])
    ctx.beginPath()
    ctx.moveTo(FIELD_WIDTH / 2, 60)
    ctx.lineTo(FIELD_WIDTH / 2, FIELD_HEIGHT - 60)
    ctx.stroke()
    ctx.setLineDash([])

    ctx.fillStyle = 'rgba(226, 232, 240, 0.08)'
    drawRoundedRect(ctx, 60, 60, FIELD_WIDTH - 120, FIELD_HEIGHT - 120, 28)
    ctx.fill()

    // projectiles
    this.projectiles.forEach((projectile) => {
      ctx.beginPath()
      ctx.fillStyle = projectile.color
      ctx.arc(projectile.position.x, projectile.position.y, projectile.radius, 0, Math.PI * 2)
      ctx.fill()
    })

    // fighters
    this.entities.forEach((entity) => {
      ctx.save()
      ctx.translate(entity.position.x, entity.position.y)
      if (!entity.alive) {
        ctx.globalAlpha = 0.2
      }
      ctx.beginPath()
      ctx.fillStyle = entity.color
      ctx.arc(0, 0, entity.radius, 0, Math.PI * 2)
      ctx.fill()

      if (entity.isPlayer) {
        ctx.strokeStyle = '#fef9c3'
        ctx.lineWidth = 3
        ctx.beginPath()
        ctx.arc(0, 0, entity.radius + 4, 0, Math.PI * 2)
        ctx.stroke()
      }

      if (entity.type === 'robo') {
        ctx.fillStyle = '#fdf2f8'
        ctx.font = '18px "Baloo 2", sans-serif'
        ctx.fillText('🤖', -11, 6)
      } else {
        ctx.fillStyle = '#0f172a'
        ctx.font = '18px "Baloo 2", sans-serif'
        ctx.fillText(entity.team === 'manual' ? '🐿️' : '🐹', -11, 6)
      }

      if (entity.alive && entity.hp < entity.maxHp) {
        ctx.fillStyle = 'rgba(15, 23, 42, 0.7)'
        ctx.fillRect(-22, -entity.radius - 16, 44, 6)
        ctx.fillStyle = entity.team === 'manual' ? '#f97316' : '#38bdf8'
        ctx.fillRect(-22, -entity.radius - 16, (44 * entity.hp) / entity.maxHp, 6)
      }

      ctx.restore()
    })

    // effects
    this.effects.forEach((effect) => {
      switch (effect.type) {
        case 'hit':
          ctx.beginPath()
          ctx.strokeStyle = effect.color ?? '#fde68a'
          ctx.lineWidth = 2
          ctx.arc(effect.position.x, effect.position.y, 28 * effect.ttl, 0, Math.PI * 2)
          ctx.stroke()
          break;
        case 'confetti':
          for (let i = 0; i < 10; i += 1) {
            const angle = (Math.PI * 2 * i) / 10
            const radius = 30 * effect.ttl
            ctx.fillStyle = i % 2 === 0 ? effect.color : '#fef3c7'
            ctx.fillRect(
              effect.position.x + Math.cos(angle) * radius,
              effect.position.y + Math.sin(angle) * radius,
              4,
              10
            )
          }
          break;
        case 'muzzle':
          ctx.beginPath()
          ctx.fillStyle = effect.color
          ctx.arc(effect.position.x, effect.position.y, 18 * effect.ttl, 0, Math.PI * 2)
          ctx.fill()
          break;
        case 'robo-spawn':
          ctx.beginPath()
          ctx.strokeStyle = '#c084fc'
          ctx.lineWidth = 3
          ctx.setLineDash([12, 12])
          ctx.arc(effect.position.x, effect.position.y, 40 + 40 * (1 - effect.ttl), 0, Math.PI * 2)
          ctx.stroke()
          ctx.setLineDash([])
          break;
        case 'ko-honk':
          ctx.fillStyle = '#fef3c7'
          ctx.font = '22px "Baloo 2", sans-serif'
          ctx.fillText('🎺 BONK!', effect.position.x - 42, effect.position.y - 24)
          break;
        default:
          break;
      }
    })

    // top overlay scoreboard
    const boardWidth = Math.min(560, FIELD_WIDTH - 160)
    const boardHeight = 62
    const boardX = FIELD_WIDTH / 2 - boardWidth / 2
    const boardY = 0
    ctx.save()
    ctx.shadowColor = 'rgba(5, 12, 34, 0.45)'
    ctx.shadowBlur = 18
    ctx.shadowOffsetY = 10
    drawRoundedRect(ctx, boardX, boardY, boardWidth, boardHeight, 30)
    const boardGradient = ctx.createLinearGradient(boardX, boardY, boardX + boardWidth, boardY + boardHeight)
    boardGradient.addColorStop(0, 'rgba(15, 23, 42, 0.78)')
    boardGradient.addColorStop(1, 'rgba(30, 41, 59, 0.68)')
    ctx.fillStyle = boardGradient
    ctx.fill()
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.28)'
    ctx.lineWidth = 1.5
    ctx.stroke()
    ctx.restore()

    const centerX = FIELD_WIDTH / 2
    const topLabel =
      this.phase === 'champion'
        ? 'Match Complete'
        : this.phase === 'intermission'
        ? 'Intermission'
        : `Round ${this.round} of ${this.maxRounds}`
    ctx.textAlign = 'center'
    ctx.fillStyle = '#ffffff'
    ctx.font = '18px "Baloo 2", sans-serif'
    ctx.fillText(topLabel, centerX, boardY + 28)

    ctx.font = '13px "Baloo 2", sans-serif'
    ctx.fillStyle = 'rgba(226, 232, 240, 0.82)'
    ctx.fillText(`First to ${this.winsToClaim} wins`, centerX, boardY + 48)

    const squirrelsTextX = boardX + 36
    const miceTextX = boardX + boardWidth - 36
    const badgeY = boardY + 54

    ctx.textAlign = 'left'
    ctx.font = '16px "Baloo 2", sans-serif'
    ctx.fillStyle = '#fcd34d'
    ctx.fillText('Squirrels 🐿️', squirrelsTextX, boardY + 26)
    ctx.font = '32px "Baloo 2", sans-serif'
    ctx.fillStyle = '#fb923c'
    ctx.fillText(`${this.manualWins}`, squirrelsTextX, badgeY)

    ctx.textAlign = 'right'
    ctx.font = '16px "Baloo 2", sans-serif'
    ctx.fillStyle = '#93c5fd'
    ctx.fillText('🐭 Mice', miceTextX, boardY + 26)
    ctx.font = '32px "Baloo 2", sans-serif'
    ctx.fillStyle = '#38bdf8'
    ctx.fillText(`${this.autonomyWins}`, miceTextX, badgeY)

    if (this.playerSide === 'autonomy' && this.roboEnabled && this.phase === 'running' && this.roboReady > 0) {
      const bannerWidth = Math.min(420, FIELD_WIDTH - 220)
      const bannerHeight = 92
      const bannerX = FIELD_WIDTH / 2 - bannerWidth / 2
      const bannerY = FIELD_HEIGHT - 160

      ctx.save()
      ctx.shadowColor = 'rgba(59, 130, 246, 0.55)'
      ctx.shadowBlur = 28
      ctx.shadowOffsetY = 16
      drawRoundedRect(ctx, bannerX, bannerY, bannerWidth, bannerHeight, 26)
      const bannerGradient = ctx.createLinearGradient(
        bannerX,
        bannerY,
        bannerX + bannerWidth,
        bannerY + bannerHeight
      )
      bannerGradient.addColorStop(0, 'rgba(30, 64, 175, 0.94)')
      bannerGradient.addColorStop(1, 'rgba(59, 130, 246, 0.94)')
      ctx.fillStyle = bannerGradient
      ctx.fill()
      ctx.strokeStyle = 'rgba(191, 219, 254, 0.65)'
      ctx.lineWidth = 2
      ctx.stroke()
      ctx.restore()

      const keyWidth = 54
      const keyHeight = 54
      const keyX = bannerX + 28
      const keyY = bannerY + bannerHeight / 2 - keyHeight / 2

      ctx.save()
      ctx.fillStyle = 'rgba(15, 23, 42, 0.82)'
      drawRoundedRect(ctx, keyX, keyY, keyWidth, keyHeight, 12)
      ctx.fill()
      ctx.strokeStyle = 'rgba(148, 197, 253, 0.85)'
      ctx.lineWidth = 2
      ctx.stroke()
      ctx.fillStyle = '#e0f2fe'
      ctx.font = '24px "Baloo 2", sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('R', keyX + keyWidth / 2, keyY + keyHeight / 2 + 10)
      ctx.restore()

      const labelX = keyX + keyWidth + 24
      ctx.textAlign = 'left'
      ctx.fillStyle = '#f8fafc'
      ctx.font = '20px "Baloo 2", sans-serif'
      ctx.fillText('Robot-Nut ready for launch!', labelX, bannerY + 38)

      ctx.font = '16px "Baloo 2", sans-serif'
      ctx.fillStyle = '#e0f2fe'
      const reminder =
        this.roboReady > 1
          ? `Press R to deploy • ${this.roboReady} charges primed`
          : 'Press R to deploy your Robo-Nut'
      ctx.fillText(reminder, labelX, bannerY + 64)
    }

    ctx.textAlign = 'start'
  }

  setPlayerControl(mode) {
    const nextMode = mode === 'auto' ? 'auto' : 'player'
    if (this.playerControl === nextMode) return
    this.playerControl = nextMode
    if (nextMode !== 'player') {
      this.keys = {}
    }
  }
}

const useGameEngine = ({
  playerSide,
  restartKey,
  onSnapshot,
  onMatchState,
  config,
  configVersion,
  isSuspended = false,
}) => {
  const canvasRef = useRef(null)
  const engineRef = useRef(null)

  useEffect(() => {
    if (isSuspended) {
      if (engineRef.current) {
        engineRef.current.destroy()
        engineRef.current = null
      }
      return undefined
    }
    const canvas = canvasRef.current
    if (!canvas || restartKey <= 0) return undefined
    const engine = new NutcrackerGame(canvas, {
      playerSide,
      restartKey,
      onSnapshot,
      onMatchState,
      config,
    })
    engineRef.current = engine
    engine.start()
    return () => {
      engineRef.current = null
      engine.destroy()
    }
  }, [playerSide, restartKey, onSnapshot, onMatchState, config, configVersion, isSuspended])

  const setPlayerControl = useCallback(
    (mode) => {
      if (isSuspended) return
      engineRef.current?.setPlayerControl(mode)
    },
    [isSuspended],
  )

  return { canvasRef, setPlayerControl }
}

function App() {
  const [playerSide, setPlayerSide] = useState('manual')
  const [restartKey, setRestartKey] = useState(0)
  const [gameActive, setGameActive] = useState(false)
  const [gameConfig, setGameConfig] = useState({
    maxRounds: DEFAULT_MAX_ROUNDS,
    maxRobo: DEFAULT_MAX_ROBO,
    roboEnabled: true,
    roboSpawnBase: 8,
    roboSpawnSpacing: 6,
  })
  const [configVersion, setConfigVersion] = useState(0)
  const [overlayStage, setOverlayStage] = useState('menu')
  const [campaignPhase, setCampaignPhase] = useState('intro')
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [highlightFullscreen, setHighlightFullscreen] = useState(false)
  const [lastResult, setLastResult] = useState(null)
  const [, setSnapshot] = useState({
    phase: 'idle',
    timeRemaining: null,
    round: 1,
    maxRounds: DEFAULT_MAX_ROUNDS,
    manualWins: 0,
    autonomyWins: 0,
    manual: { hp: 0, fighters: [] },
    autonomy: { hp: 0, fighters: [] },
    roboReady: 0,
    roboRemaining: null,
    player: null,
    winner: null,
    champion: null,
  })
  const [matchState, setMatchState] = useState({ status: 'idle' })
  const [campaignCasualties, setCampaignCasualties] = useState({
    duel: null,
    series: null,
    finale: null,
  })
  const canvasContainerRef = useRef(null)
  const [isMobileViewport, setIsMobileViewport] = useState(() => detectMobileViewport())

  const { maxRounds } = gameConfig

  useEffect(() => {
    if (!gameActive) return
    setMatchState({
      status: 'running',
      round: 1,
      manualWins: 0,
      autonomyWins: 0,
      maxRounds,
    })
    setRestartKey((prev) => prev + 1)
  }, [playerSide, gameActive, configVersion, maxRounds])

  useEffect(() => {
    if (matchState.status !== 'match-finished') return
    const { casualties } = matchState
    if (!casualties) return
    setCampaignCasualties((prev) => {
      if (campaignPhase === 'duel') {
        return {
          ...prev,
          duel: { manual: casualties.totals.manual ?? 0, autonomy: casualties.totals.autonomy ?? 0 },
        }
      }
      if (campaignPhase === 'series') {
        const roundsPlayed = casualties.rounds?.length ?? 0
        return {
          ...prev,
          series: {
            totals: {
              manual: casualties.totals.manual ?? 0,
              autonomy: casualties.totals.autonomy ?? 0,
            },
            rounds: roundsPlayed,
          },
        }
      }
      if (campaignPhase === 'finale') {
        return {
          ...prev,
          finale: {
            manual: casualties.totals.manual ?? 0,
            autonomy: casualties.totals.autonomy ?? 0,
          },
        }
      }
      return prev
    })
  }, [matchState, campaignPhase])

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement))
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
    }
  }, [])

  useEffect(() => {
    if (!highlightFullscreen) return
    const timer = window.setTimeout(() => setHighlightFullscreen(false), 3600)
    return () => window.clearTimeout(timer)
  }, [highlightFullscreen])

  useEffect(() => {
    if (overlayStage !== null) return
    if (matchState.status !== 'match-finished') return
    setGameActive(false)
    setLastResult(matchState)
    if (campaignPhase === 'duel') {
      setOverlayStage('duel-victory')
    } else if (campaignPhase === 'series') {
      setOverlayStage('series-epilogue')
    } else if (campaignPhase === 'finale') {
      setOverlayStage('finale-outro')
    }
  }, [matchState, overlayStage, campaignPhase])

  const handleToggleFullscreen = () => {
    if (document.fullscreenElement) {
      if (document.exitFullscreen) {
        document.exitFullscreen()
      }
      return
    }
    const target = canvasContainerRef.current
    if (target?.requestFullscreen) {
      target.requestFullscreen()
    }
  }

  const updateGameConfig = useCallback((nextConfig) => {
    setGameConfig(nextConfig)
    setConfigVersion((prev) => prev + 1)
  }, [])

  const beginBalancedSkirmish = useCallback(() => {
    setCampaignPhase('duel')
    setPlayerSide('autonomy')
    setCampaignCasualties({ duel: null, series: null, finale: null })
    setMatchState({ status: 'pending' })
    updateGameConfig({
      maxRounds: DEFAULT_MAX_ROUNDS,
      maxRobo: 0,
      roboEnabled: false,
    })
    setGameActive(true)
    setOverlayStage(null)
    setHighlightFullscreen(true)
    setLastResult(null)
  }, [updateGameConfig])

  const beginRoboSeries = useCallback(() => {
    setCampaignPhase('series')
    setPlayerSide('autonomy')
    setMatchState({ status: 'pending' })
    setCampaignCasualties((prev) => ({ ...prev, series: null, finale: null }))
    updateGameConfig({
      maxRounds: DEFAULT_MAX_ROUNDS,
      maxRobo: DEFAULT_MAX_ROBO,
      roboEnabled: true,
      roboSpawnBase: 6,
      roboSpawnSpacing: 4,
    })
    setGameActive(true)
    setOverlayStage(null)
    setHighlightFullscreen(true)
    setLastResult(null)
  }, [updateGameConfig])

  const beginFinale = useCallback(() => {
    setCampaignPhase('finale')
    setPlayerSide('manual')
    setMatchState({ status: 'pending' })
    setCampaignCasualties((prev) => ({ ...prev, finale: null }))
    updateGameConfig({
      maxRounds: DEFAULT_MAX_ROUNDS,
      maxRobo: DEFAULT_MAX_ROBO,
      roboEnabled: true,
      roboSpawnBase: 6,
      roboSpawnSpacing: 4,
    })
    setGameActive(true)
    setOverlayStage(null)
    setHighlightFullscreen(true)
    setLastResult(null)
  }, [updateGameConfig])

  useEffect(() => {
    const handleViewportChange = () => {
      setIsMobileViewport(detectMobileViewport())
    }
    handleViewportChange()
    window.addEventListener('resize', handleViewportChange)
    window.addEventListener('orientationchange', handleViewportChange)
    return () => {
      window.removeEventListener('resize', handleViewportChange)
      window.removeEventListener('orientationchange', handleViewportChange)
    }
  }, [])

  const renderOverlay = () => {
    switch (overlayStage) {
      case 'menu':
  return (
          <div className="game-menu card-panel">
            <h2>Nutcracker Showdown</h2>
            <p>
              A story-driven campaign through the Nutcracker grove. Guide the mice, witness the rise of the
              Robo-Nut legion, and finish the saga by defending the forest as the squirrels.
            </p>
            <div className="menu-illustration-wrapper tall">
              <svg
                className="menu-illustration"
                viewBox="0 0 360 230"
                role="img"
                aria-label="Squirrels and mice preparing for battle"
                xmlns="http://www.w3.org/2000/svg"
              >
                <defs>
                  <linearGradient id="dawn" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stopColor="#fde68a" />
                    <stop offset="100%" stopColor="#f97316" />
                  </linearGradient>
                  <linearGradient id="badgeBlue" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="rgba(59, 130, 246, 0.6)" />
                    <stop offset="100%" stopColor="rgba(30, 64, 175, 0.8)" />
                  </linearGradient>
                  <linearGradient id="badgeTeal" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="rgba(45, 212, 191, 0.6)" />
                    <stop offset="100%" stopColor="rgba(13, 148, 136, 0.8)" />
                  </linearGradient>
                </defs>
                <rect x="0" y="0" width="360" height="230" fill="url(#dawn)" opacity="0.9" />
                <g opacity="0.35">
                  <circle cx="70" cy="60" r="32" fill="#172554" />
                  <circle cx="290" cy="64" r="34" fill="#083344" />
                  <circle cx="178" cy="42" r="28" fill="#0f172a" />
                </g>
                <path d="M0 162 Q90 138 180 162 T360 162 L360 230 L0 230 Z" fill="rgba(15, 23, 42, 0.92)" />
                <path d="M0 144 Q90 124 180 144 T360 144" fill="none" stroke="rgba(8, 47, 73, 0.68)" strokeWidth="8" />
                <g transform="translate(180 70)">
                  <rect x="-108" y="-38" width="216" height="64" rx="20" fill="rgba(15, 23, 42, 0.78)" />
                  <text x="0" y="-8" textAnchor="middle" fontSize="18" fill="#fbbf24" letterSpacing="0.1em">
                    FOREST FRONTLINE
                  </text>
                  <text x="0" y="16" textAnchor="middle" fontSize="11" fill="#bfdbfe" letterSpacing="0.12em">
                    SQUIRRELS VS MICE
                  </text>
                </g>
                <g transform="translate(110 150)">
                  <rect x="-62" y="-36" width="124" height="80" rx="24" fill="rgba(15, 30, 64, 0.85)" />
                  <rect x="-55" y="-30" width="110" height="26" rx="13" fill="url(#badgeBlue)" />
                  <text x="0" y="-12" textAnchor="middle" fontSize="13" fill="#f8fafc">
                    Nutcat Battalion
                  </text>
                  <text x="0" y="24" textAnchor="middle" fontSize="24">
                    🐿️
                  </text>
                </g>
                <g transform="translate(250 150)">
                  <rect x="-62" y="-36" width="124" height="80" rx="24" fill="rgba(9, 30, 42, 0.85)" />
                  <rect x="-55" y="-30" width="110" height="26" rx="13" fill="url(#badgeTeal)" />
                  <text x="0" y="-12" textAnchor="middle" fontSize="13" fill="#ecfeff">
                    Whisker Brigade
                  </text>
                  <text x="0" y="24" textAnchor="middle" fontSize="24">
                    🐭
                  </text>
                </g>
                <text x="180" y="210" textAnchor="middle" fontSize="14" fill="#f1f5f9">
                  Truce ends when you begin the campaign
                </text>
              </svg>
        </div>
            <div className="menu-instructions">
              <h3>Battlefield Controls</h3>
          <ul>
            <li>
                  <strong>Move:</strong> WASD / Arrow Keys keep your commander nimble.
            </li>
            <li>
                  <strong>Nut Sling:</strong> Tap J or Space to volley shells downrange.
            </li>
            <li>
                  <strong>Dodge:</strong> Weave constantly to dodge hits and protect your HP.
            </li>
            <li>
                  <strong>Robo-Nut Launch:</strong> As the mice, press R when charges glow.
            </li>
          </ul>
        </div>
            <button type="button" className="menu-start-button" onClick={() => setOverlayStage('war-brief')}>
              Begin Campaign
            </button>
          </div>
        )
      case 'war-brief':
        return (
          <div className="story-panel card-panel">
            <h2>Prologue — Splinters in the Grove</h2>
            <p>
              Acorn droughts and shrinking shade drove the squirrels and mice from allies to rivals. Both
              sides dug trenches along the great cedar, each convinced the other hoarded the last harvest.
            </p>
            <p>
              You arrive as a neutral tactician. The mice beg for a fair fight to prove their agility, while
              the squirrels trust their strength. A hopeful few whisper about a future council of the United
              Nutions, but first you must command the mice for one honest skirmish and learn the battlefield.
            </p>
            <div className="story-actions">
              <button type="button" className="menu-start-button" onClick={beginBalancedSkirmish}>
                Lead the Mice into Battle
              </button>
          </div>
          </div>
        )
      case 'duel-victory': {
        const champion = lastResult?.champion
        const duelScore = lastResult
          ? `Scoreboard • Squirrels ${lastResult.manualWins} : ${lastResult.autonomyWins} Mice`
          : 'The first clash is decided.'
        const winnerLine =
          champion === 'manual'
            ? 'The Squirrel Vanguard holds the line and keeps the cedar safe — for now.'
            : champion === 'autonomy'
            ? 'The Whisker Brigade darts through the trenches and claims a swift victory.'
            : 'Neither side ceded an inch. The grove grows ever more anxious.'
        return (
          <div className="story-panel card-panel">
            <h2>After-Action Report</h2>
            <p>{winnerLine}</p>
            <p>{duelScore}</p>
            <p>
              Word spreads through the understory. An eccentric field medic swears the mice can seize the
              grove with a new invention — an autonomous Robo-Nut partner.
            </p>
            <div className="story-actions">
              <button type="button" className="menu-start-button" onClick={() => setOverlayStage('doctor-lore')}>
                Meet the Inventor
              </button>
            </div>
          </div>
        )
      }
      case 'doctor-lore':
        return (
          <div className="story-panel card-panel">
            <h2>Dr. Thistlewick's Revelation</h2>
            <p>
              Dr. Juniper Thistlewick — a soft-spoken flying squirrel turned battlefield doctor — unveils her
              creation: the Robo-Nut, a clockwork ally guided by seed-oil gyros and acorn charisma.
            </p>
            <p>
              She gifts the prototypes to the mice, hoping the machines will end the war quickly and spare
              lives. Take command of the Robo squad and prove her theory across a full five-round engagement.
            </p>
            <div className="story-actions">
              <button type="button" className="menu-start-button" onClick={beginRoboSeries}>
                Deploy the Robo-Nut Legion
              </button>
            </div>
          </div>
        )
      case 'series-epilogue': {
        const champion = lastResult?.champion
        const finaleLine =
          champion === 'autonomy'
            ? 'Robo shells streak across the trenches. The mice own the night, and squirrels scramble for cover.'
            : champion === 'manual'
            ? 'Even steel paws falter — the squirrels rally and shatter the prototypes.'
            : 'Both armies limp away, the machines humming alongside bruised squads.'
        const seriesScore = lastResult
          ? `Series tally • Squirrels ${lastResult.manualWins} : ${lastResult.autonomyWins} Mice`
          : 'The five-round clash ends in exhausted silence.'
        return (
          <div className="story-panel card-panel">
            <h2>Between Acts — Smoke & Sap</h2>
            <p>{finaleLine}</p>
            <p>{seriesScore}</p>
            <p>
              Rumours whirl that the squirrels now court their own mechanised answer. It&apos;s time to cross
              the trench and see the fight through their eyes.
            </p>
            <div className="story-actions">
              <button type="button" className="menu-start-button" onClick={() => setOverlayStage('final-shift')}>
                Cross the Trench
              </button>
            </div>
          </div>
        )
      }
      case 'final-shift':
        return (
          <div className="story-panel card-panel">
            <h2>Act III Briefing — Guardians of the Canopy</h2>
            <p>
              The squirrels patch their wounds and swear to reclaim the grove. You will now command their
              ranks, facing the very Robo-Nut waves you once unleashed.
            </p>
            <p>
              Hold fast, break the drones, and show both tribes there is a path to peace beyond mechanised
              escalation.
            </p>
            <div className="story-actions">
              <button type="button" className="menu-start-button" onClick={beginFinale}>
                Stand with the Squirrels
              </button>
            </div>
          </div>
        )
      case 'finale-outro': {
        const champion = lastResult?.champion
        const finalLine =
          champion === 'manual'
            ? 'The squirrels reclaim the cedar and vow to dismantle every rogue drone.'
            : champion === 'autonomy'
            ? 'The mice secure the canopy crown, promising fair harvests under Robo-Nut watch.'
            : 'Neither side could claim the grove. Perhaps stalemate is the only path to lasting peace.'
        const finalScore = lastResult
          ? `Final verdict • Squirrels ${lastResult.manualWins} : ${lastResult.autonomyWins} Mice`
          : 'The campaign concludes with weary soldiers on both sides.'
        const duelCasualties = campaignCasualties.duel
        const seriesTotals = campaignCasualties.series?.totals
        const finaleCasualties = campaignCasualties.finale
        return (
          <div className="story-panel card-panel">
            <h2>Epilogue — Seeds of a Truce</h2>
            <p>{finalLine}</p>
            <p>{finalScore}</p>
            <p>
              The forest hushes. Whether you forged dominance or detente, the tale of the Nutcracker
              Showdown now belongs to you.
            </p>
            <table className="campaign-casualties-summary">
              <thead>
                <tr>
                  <th>Act</th>
                  <th>Squirrels Lost</th>
                  <th>Mice Lost</th>
                </tr>
              </thead>
              <tbody>
                {duelCasualties && (
                  <tr>
                    <td>Act I — Even Ground</td>
                    <td>{duelCasualties.manual}</td>
                    <td>{duelCasualties.autonomy}</td>
                  </tr>
                )}
                {seriesTotals && (
                  <tr>
                    <td>Act II — Steel & Sap</td>
                    <td>{seriesTotals.manual ?? 0}</td>
                    <td>{seriesTotals.autonomy ?? 0}</td>
                  </tr>
                )}
                {finaleCasualties && (
                  <tr>
                    <td>Act III — Claws of the Canopy</td>
                    <td>{finaleCasualties.manual ?? 0}</td>
                    <td>{finaleCasualties.autonomy ?? 0}</td>
                  </tr>
                )}
              </tbody>
            </table>
            <p className="session-wrapup">
              When your squad is done reviewing the report, please raise your hand so the instructors know you're finished.
            </p>
          </div>
        )
      }
      default:
        return null
    }
  }

  const { canvasRef, setPlayerControl } = useGameEngine({
    playerSide,
    restartKey,
    onSnapshot: setSnapshot,
    onMatchState: setMatchState,
    config: gameConfig,
    configVersion,
    isSuspended: isMobileViewport,
  })

  useEffect(() => {
    const mode = overlayStage || isMobileViewport ? 'auto' : 'player'
    setPlayerControl(mode)
  }, [overlayStage, isMobileViewport, setPlayerControl])

  if (isMobileViewport) {
    return (
      <div className="mobile-blocker">
        <div className="mobile-blocker-content">
          <h1>Nutcracker Showdown</h1>
          <p>This training simulation is optimised for full-size windowed desktop and laptop displays.</p>
          <p>Revisit on a full-size brower window or different device to command the battlefield.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="app-shell">
      {overlayStage && (
        <div className="game-menu-overlay">
          {renderOverlay()}
        </div>
      )}
      <section className="card-panel canvas-wrapper" ref={canvasContainerRef}>
        <div className="canvas-actions">
          <button
            type="button"
            className={`fullscreen-toggle${highlightFullscreen ? ' highlight' : ''}`}
            onClick={handleToggleFullscreen}
          >
            {isFullscreen ? 'Exit Fullscreen' : 'Go Fullscreen'}
          </button>
        </div>
        <canvas ref={canvasRef} width={FIELD_WIDTH} height={FIELD_HEIGHT} />
      </section>
    </div>
  )
}

export default App
