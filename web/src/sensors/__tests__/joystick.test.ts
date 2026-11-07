import { describe, expect, it } from 'vitest'
import { joystickVector } from '../joystick'

describe('joystickVector（圓形搖桿）', () => {
  it('center and the dead zone give no movement', () => {
    expect(joystickVector(0, 0, 50)).toEqual({ forward: 0, right: 0, knobX: 0, knobY: 0 })
    expect(joystickVector(3, -2, 50)).toMatchObject({ forward: 0, right: 0 })
  })

  it('dragging up is forward, right is right (screen y grows downward)', () => {
    expect(joystickVector(0, -50, 50)).toMatchObject({ forward: 1, right: 0 })
    expect(joystickVector(25, 0, 50).right).toBeCloseTo(0.5)
    expect(joystickVector(0, 25, 50).forward).toBeCloseTo(-0.5)
  })

  it('is clamped to the circle, keeping the direction', () => {
    const v = joystickVector(300, -300, 50)
    expect(Math.hypot(v.forward, v.right)).toBeCloseTo(1)
    expect(v.forward).toBeCloseTo(v.right)
    expect(Math.hypot(v.knobX, v.knobY)).toBeCloseTo(50)
  })
})
