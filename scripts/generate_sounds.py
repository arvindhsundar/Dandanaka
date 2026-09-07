#!/usr/bin/env python3
"""Synthesize the starter sound pack. Everything here is generated from noise and
oscillators, so the output is CC0 by construction. Writes mp3s + manifest.json.

Usage: python3 scripts/generate_sounds.py [--wav]
Requires: numpy scipy lameenc  (pip install numpy scipy lameenc)
"""
import json, os, sys, math
import numpy as np
from scipy import signal

SR = 44100
OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'sounds')
rng = np.random.default_rng(20260907)

# ---------- helpers ----------
def t(sec): return np.arange(int(SR * sec)) / SR
def white(sec): return rng.standard_normal(int(SR * sec)).astype(np.float32)
def pink(sec):
    # Paul Kellet's economical pink filter
    w = white(sec); b = np.zeros(7); out = np.empty_like(w)
    for i, x in enumerate(w):
        b[0] = 0.99886*b[0] + x*0.0555179; b[1] = 0.99332*b[1] + x*0.0750759
        b[2] = 0.96900*b[2] + x*0.1538520; b[3] = 0.86650*b[3] + x*0.3104856
        b[4] = 0.55000*b[4] + x*0.5329522; b[5] = -0.7616*b[5] - x*0.0168980
        out[i] = (b[0]+b[1]+b[2]+b[3]+b[4]+b[5]+b[6] + x*0.5362) * 0.11
        b[6] = x*0.115926
    return out
def brown(sec):
    w = white(sec); out = np.cumsum(w) ; out -= np.linspace(out[0], out[-1], len(out))
    return (out / (np.abs(out).max() + 1e-9)).astype(np.float32)
def lp(x, fc, order=2): b, a = signal.butter(order, min(fc, SR/2-1)/(SR/2), 'low'); return signal.lfilter(b, a, x)
def hp(x, fc, order=2): b, a = signal.butter(order, max(fc, 10)/(SR/2), 'high'); return signal.lfilter(b, a, x)
def bp(x, lo, hi, order=2): b, a = signal.butter(order, [max(lo,10)/(SR/2), min(hi, SR/2-1)/(SR/2)], 'band'); return signal.lfilter(b, a, x)
def env_adsr(n, a=0.01, d=0.1, s=0.7, r=0.3):
    a_, d_, r_ = int(a*SR), int(d*SR), int(r*SR); s_ = max(n - a_ - d_ - r_, 0)
    e = np.concatenate([np.linspace(0,1,a_), np.linspace(1,s,d_), np.full(s_, s), np.linspace(s,0,r_)])
    return np.pad(e, (0, max(0, n-len(e))))[:n]
def expdecay(sec, tau): x = t(sec); return np.exp(-x / tau)
def sine(freq, sec, phase=0): return np.sin(2*np.pi*freq*t(sec) + phase)
def saw(freq, sec): x = t(sec); return 2*((x*freq) % 1.0) - 1
def reverb(x, sec=1.2, mix=0.3, tau=0.35):
    ir = white(sec) * expdecay(sec, tau); ir = lp(ir, 6000); ir /= np.abs(ir).max()
    wet = signal.fftconvolve(x, ir)[:len(x)] * 0.15
    return x * (1-mix) + wet * mix * 4
def normalize(x, peak=0.89):
    x = np.asarray(x, dtype=np.float64); m = np.abs(x).max()
    return (x / m * peak) if m > 0 else x
def place(canvas, snd, at_sec, gain=1.0):
    i = int(at_sec * SR); n = min(len(snd), len(canvas) - i)
    if n > 0: canvas[i:i+n] += snd[:n] * gain
def loopify(x, xf=0.5):
    n = int(xf * SR); head = x[:n].copy(); out = x[n:].copy()
    k = np.linspace(0, 1, n); a = np.cos(k*np.pi/2); b = np.sin(k*np.pi/2)
    out[-n:] = out[-n:]*a + head*b
    return out
def soft(x, drive=1.5): return np.tanh(x*drive)/math.tanh(drive)

# ---------- ambience ----------
def rain(sec=24):
    base = bp(white(sec), 900, 9000) * 0.35 + lp(pink(sec), 3000) * 0.4
    drops = np.zeros(int(SR*sec))
    for _ in range(int(sec*35)):
        d = bp(white(0.03), 2500+rng.uniform(0,3000), 8000) * expdecay(0.03, 0.006)
        place(drops, d, rng.uniform(0, sec-0.05), rng.uniform(0.2, 0.9))
    return loopify(base + drops*0.6)
def wind(sec=24):
    x = t(sec); lfo = 0.5 + 0.5*np.sin(2*np.pi*0.07*x + 1) * 0.8 + 0.2*np.sin(2*np.pi*0.23*x)
    n = pink(sec)
    # slowly sweeping bandpass, done in chunks
    out = np.zeros_like(n); chunk = 2048
    for i in range(0, len(n), chunk):
        fc = 250 + 900*lfo[min(i, len(lfo)-1)]
        out[i:i+chunk] = bp(n[i:i+chunk], fc*0.6, fc*1.8, 1)
    return loopify(out * (0.4 + 0.6*lfo))
def storm(sec=28):
    r = rain(sec); w = wind(sec)
    n = min(len(r), len(w)); out = r[:n]*0.8 + w[:n]*0.6
    for at in (4.0, 15.5):
        place(out, thunder(rng.uniform(4, 6))*0.7, at)
    return loopify(out)
def forest_night(sec=26):
    out = lp(pink(sec), 800) * 0.08
    # crickets: bursts of 4kHz chirps, a few individuals at slightly different rates
    for k in range(4):
        f = 3800 + k*250; rate = 9 + k*2; period = 1/rate
        chirp = sine(f, 0.012) * env_adsr(int(0.012*SR), 0.002, 0.004, 0.5, 0.005)
        phase = rng.uniform(0, 3)
        while phase < sec:
            for j in range(int(rng.integers(6, 14))):
                place(out, chirp, phase + j*period, 0.10)
            phase += rng.uniform(1.2, 3.5)
    for at in (6.0, 17.5):
        place(out, owl(), at, 0.5)
    return loopify(out)
def campfire(sec=24):
    low = lp(brown(sec), 120) * 0.35 + lp(pink(sec), 500) * 0.12
    out = low.copy()
    for _ in range(int(sec*18)):
        c = bp(white(0.02), 1500+rng.uniform(0,4000), 9000) * expdecay(0.02, 0.003)
        place(out, c, rng.uniform(0, sec-0.05), rng.uniform(0.3, 1.0))
    for _ in range(int(sec*2)):
        p = lp(white(0.08), 400) * expdecay(0.08, 0.02)
        place(out, p, rng.uniform(0, sec-0.1), 0.8)
    return loopify(out)
def dungeon(sec=26):
    drone = (sine(55, sec) + 0.5*sine(55*1.5, sec) + 0.3*sine(82.5*1.01, sec)) * 0.12
    wisps = bp(pink(sec), 300, 1200) * (0.5+0.5*np.sin(2*np.pi*0.05*t(sec))) * 0.06
    out = drone + wisps
    for _ in range(int(sec*0.7)):
        f = rng.uniform(1200, 2600); d = sine(f, 0.25) * expdecay(0.25, 0.03)
        d = reverb(d, 1.5, 0.6, 0.5)
        place(out, d, rng.uniform(0, sec-1.6), 0.35)
    return loopify(out)
def cave_drone(sec=24):
    x = t(sec)
    out = (sine(41.2, sec) + 0.6*sine(41.2*2.01, sec) + 0.4*sine(61.7, sec)*np.sin(2*np.pi*0.03*x)**2 + 0.3*sine(123.5, sec)*(0.5+0.5*np.sin(2*np.pi*0.021*x)))
    out = out*0.18 + lp(pink(sec), 250)*0.08
    return loopify(out)
def ocean(sec=30):
    x = t(sec); swell = (0.5 + 0.5*np.sin(2*np.pi*0.09*x))**2.2
    n = lp(pink(sec), 1800)
    out = n * (0.15 + 0.85*swell) * 0.6 + lp(brown(sec), 150)*0.25*swell
    return loopify(out)
def tavern(sec=26):
    out = np.zeros(int(SR*sec))
    # a dozen voices: band-limited noise shaped by syllable envelopes, pitched by a low formant
    for v in range(12):
        f0 = rng.uniform(110, 240); pos = rng.uniform(0, 2)
        while pos < sec:
            dur = rng.uniform(0.08, 0.22)
            n = int(dur*SR)
            syl = bp(white(dur), f0*2, f0*12) * env_adsr(n, 0.02, 0.03, 0.6, 0.04)
            syl += sine(f0*rng.uniform(0.9,1.1), dur) * env_adsr(n, 0.02, 0.03, 0.6, 0.04) * 0.3
            place(out, syl, pos, 0.05)
            pos += dur + (rng.uniform(0.6, 2.5) if rng.random() < 0.25 else rng.uniform(0.02, 0.09))
    out = lp(out, 2500)
    for _ in range(int(sec*0.5)):
        place(out, glass_clink(), rng.uniform(0, sec-0.6), 0.25)
    out += lp(pink(sec), 400)*0.05
    return loopify(reverb(out, 0.8, 0.25, 0.25))
def heartbeat(sec=8):
    out = np.zeros(int(SR*sec)); beat = 60/64
    thump = lambda: lp(sine(52, 0.18)*expdecay(0.18, 0.05) + white(0.18)*0.1*expdecay(0.18, 0.01), 180)
    pos = 0.0
    while pos < sec - 0.5:
        place(out, thump(), pos, 1.0); place(out, thump(), pos + 0.28, 0.6); pos += beat
    return loopify(out, 0.05)

# ---------- one-shots ----------
def thunder(sec=5.0):
    n = lp(brown(sec), 90, 2) * 0.7 + lp(pink(sec), 400, 2) * 0.3
    x = t(sec); e = np.exp(-x/1.3) * (1 - np.exp(-x/0.05))
    rumble = n * e * (1 + 0.5*np.sin(2*np.pi*rng.uniform(1.5,3.0)*x))
    crack = bp(white(0.25), 800, 6000) * expdecay(0.25, 0.05)
    out = rumble; place(out, crack, 0.0, 0.5)
    return soft(out, 2.0)
def sword_clash():
    sec = 1.6; out = np.zeros(int(SR*sec))
    for f in (2100, 3350, 4700, 6180, 7900):
        out += sine(f*rng.uniform(0.98,1.02), sec) * expdecay(sec, rng.uniform(0.08, 0.25)) * (2100/f)
    place(out, bp(white(0.05), 2000, 12000) * expdecay(0.05, 0.01) * 3, 0.0)
    place(out, lp(white(0.15), 300) * expdecay(0.15, 0.03) * 2, 0.0)
    return reverb(out, 0.8, 0.25, 0.2)
def heavy_hit():
    sec = 0.9
    out = sine(60, sec) * expdecay(sec, 0.12) * 1.5 + lp(white(sec), 500) * expdecay(sec, 0.04) * 1.2
    place(out, bp(white(0.06), 1000, 5000) * expdecay(0.06, 0.008), 0.0)
    return soft(out, 2.5)
def shield_block():
    sec = 0.8
    out = lp(white(sec), 900) * expdecay(sec, 0.05) + sine(180, sec)*expdecay(sec, 0.06)
    for f in (900, 1450, 2300): out += sine(f, sec)*expdecay(sec, 0.12)*0.3
    return soft(out, 2)
def arrow():
    sec = 0.7; out = np.zeros(int(SR*sec)); n = white(0.4); chunk = 512
    sw = np.zeros(int(SR*0.4))
    for i in range(0, len(n), chunk):
        fc = 600 + 5000*(i/len(n))
        sw[i:i+chunk] = bp(n[i:i+chunk], fc*0.7, fc*1.4, 1)
    place(out, sw * env_adsr(len(sw), 0.05, 0.1, 0.6, 0.15), 0.0, 0.8)
    thunk = lp(white(0.15), 700)*expdecay(0.15, 0.02) + sine(140, 0.15)*expdecay(0.15, 0.04)
    place(out, thunk, 0.42, 1.2)
    return out
def spell_cast():
    sec = 1.8; out = np.zeros(int(SR*sec)); x = t(sec)
    for k in range(14):
        f0 = rng.uniform(600, 1400); f1 = f0 * rng.uniform(2.5, 4)
        st = rng.uniform(0, 0.6); dur = 1.0
        ph = 2*np.pi*np.cumsum(np.linspace(f0, f1, int(dur*SR)))/SR
        tone = np.sin(ph) * env_adsr(int(dur*SR), 0.05, 0.2, 0.5, 0.6)
        place(out, tone, st, 0.12)
    shimmer = bp(white(sec), 4000, 12000) * (np.sin(2*np.pi*28*x)**2) * env_adsr(len(x), 0.3, 0.3, 0.6, 0.7)
    return reverb(out + shimmer*0.25, 1.5, 0.4, 0.4)
def explosion():
    sec = 2.2; x = t(sec)
    out = lp(brown(sec), 120)*np.exp(-x/0.6)*1.5 + lp(white(sec), 2500)*np.exp(-x/0.25)
    place(out, bp(white(0.08), 1500, 8000)*expdecay(0.08, 0.02)*1.5, 0.0)
    return soft(out, 3.0)
def door_creak():
    sec = 1.4; x = t(sec)
    f = 700 + 500*np.sin(2*np.pi*1.3*x) + 300*x/sec
    ph = 2*np.pi*np.cumsum(f)/SR
    tone = (np.sign(np.sin(ph))*0.5 + np.sin(ph*2)*0.4) * (0.6 + 0.4*np.sin(2*np.pi*23*x))
    tone = bp(tone, 400, 4000) * env_adsr(len(x), 0.1, 0.2, 0.8, 0.3)
    return tone
def door_slam():
    sec = 0.7
    out = lp(white(sec), 400)*expdecay(sec, 0.05)*1.5 + sine(70, sec)*expdecay(sec, 0.08)
    place(out, bp(white(0.3), 600, 3000)*expdecay(0.3, 0.06)*0.4, 0.0)
    return soft(reverb(out, 0.6, 0.2, 0.2), 2)
def coins():
    sec = 1.2; out = np.zeros(int(SR*sec))
    for i in range(9):
        f = rng.uniform(3500, 7000); d = 0.25
        p = (sine(f, d) + 0.5*sine(f*1.49, d) + 0.3*sine(f*2.13, d)) * expdecay(d, 0.05)
        place(out, p, i*0.07 + rng.uniform(0, 0.03), rng.uniform(0.4, 1))
    return out
def dice_roll():
    sec = 1.3; out = np.zeros(int(SR*sec)); pos = 0.0; gap = 0.04
    while pos < 0.95:
        c = bp(white(0.05), 1200, 6000)*expdecay(0.05, 0.006) + sine(rng.uniform(300,600), 0.05)*expdecay(0.05, 0.01)*0.5
        place(out, c, pos, rng.uniform(0.4, 1.0)); pos += gap; gap *= 1.18
    return out
def chest_open():
    sec = 1.2; out = np.zeros(int(SR*sec))
    place(out, door_creak()[:int(0.5*SR)] * np.linspace(1, 0.2, int(0.5*SR)), 0.0, 0.6)
    click = bp(white(0.04), 1500, 6000)*expdecay(0.04, 0.005)
    place(out, click, 0.55, 0.8)
    place(out, coins()[:int(0.4*SR)], 0.62, 0.3)
    return out
def dramatic_sting():
    sec = 3.0
    out = np.zeros(int(SR*sec))
    for f in (110, 130.8, 164.8, 220, 261.6):   # A minor-ish stack
        out += (saw(f, sec) + saw(f*1.005, sec)) * expdecay(sec, 0.9) * 0.15
    out = lp(out, 1800)
    out += sine(36.7, sec) * expdecay(sec, 0.6) * 0.8
    place(out, lp(white(0.3), 800)*expdecay(0.3, 0.05)*0.5, 0.0)
    return soft(reverb(out, 2.0, 0.35, 0.6), 1.8)
def victory_fanfare():
    notes = [(392, 0.18), (392, 0.18), (392, 0.18), (523.25, 0.55), (659.25, 0.6)]
    sec = sum(d for _, d in notes) + 1.2; out = np.zeros(int(SR*sec)); pos = 0.0
    for f, d in notes:
        tone = (saw(f, d+0.5) + saw(f*1.004, d+0.5)*0.7 + saw(f*0.5, d+0.5)*0.4)
        tone = lp(tone, 2200) * env_adsr(len(tone), 0.02, 0.1, 0.7, 0.5) * 0.25
        place(out, tone, pos); pos += d
    return reverb(out, 1.5, 0.3, 0.5)
def horn_call():
    notes = [(261.6, 0.6), (392, 1.2)]
    sec = 2.6; out = np.zeros(int(SR*sec)); pos = 0.1
    for f, d in notes:
        x = t(d+0.3); vib = 1 + 0.006*np.sin(2*np.pi*5.5*x)
        ph = 2*np.pi*np.cumsum(f*vib)/SR
        tone = (np.sin(ph) + 0.5*np.sin(2*ph) + 0.3*np.sin(3*ph) + 0.2*np.sin(4*ph)) * env_adsr(len(x), 0.08, 0.1, 0.8, 0.3)
        place(out, tone*0.3, pos); pos += d
    return reverb(out, 1.8, 0.35, 0.6)
def bell_toll():
    sec = 4.0; out = np.zeros(int(SR*sec))
    for f, tau, g in ((220, 2.0, 1), (220*2.0, 1.4, 0.6), (220*2.4, 1.2, 0.5), (220*3.0, 0.9, 0.35), (220*4.2, 0.6, 0.25), (220*5.4, 0.4, 0.15)):
        out += sine(f, sec) * expdecay(sec, tau) * g
    place(out, bp(white(0.03), 1000, 8000)*expdecay(0.03, 0.005)*0.8, 0.0)
    return out*0.35
def footsteps():
    sec = 2.4; out = np.zeros(int(SR*sec))
    for i in range(5):
        s = lp(white(0.12), 600)*expdecay(0.12, 0.02) + sine(90, 0.12)*expdecay(0.12, 0.03)*0.6
        place(s, bp(white(0.05), 2000, 6000)*expdecay(0.05, 0.005)*0.3, 0.0)
        place(out, s, i*0.45 + rng.uniform(-0.02, 0.02), rng.uniform(0.7, 1.0))
    return out
def glass_clink():
    d = 0.5; f = rng.uniform(2500, 4200)
    return (sine(f, d) + 0.4*sine(f*2.76, d)) * expdecay(d, 0.08)

# ---------- creatures ----------
def growl(sec, f_start, f_end, formants, noise=0.5, tau=None):
    x = t(sec); f = np.linspace(f_start, f_end, len(x)) * (1 + 0.04*np.sin(2*np.pi*rng.uniform(4,7)*x))
    ph = np.cumsum(f)/SR
    pulse = (np.sin(2*np.pi*ph) > 0.85).astype(float)   # narrow pulse train = rich harmonics
    src = pulse + white(sec)*noise*0.4
    out = np.zeros_like(src)
    for fc, q in formants: out += bp(src, fc/q, fc*q, 1)
    e = env_adsr(len(x), 0.15, 0.3, 0.8, 0.4) if tau is None else expdecay(sec, tau)
    return soft(out * e, 2)
def dragon_roar():
    out = growl(2.8, 75, 45, ((300, 1.5), (700, 1.4), (1400, 1.3)), noise=0.7)
    out += lp(brown(2.8), 80)*env_adsr(int(2.8*SR), 0.3, 0.4, 0.8, 0.5)*0.6
    return reverb(out, 2.0, 0.35, 0.6)
def monster_growl():
    out = growl(1.4, 55, 40, ((250, 1.6), (600, 1.4)), noise=0.5)
    return reverb(out, 1.0, 0.25, 0.3)
def wolf_howl():
    sec = 3.2; x = t(sec)
    f = 380 + 260*np.clip(x/0.9, 0, 1) - 180*np.clip((x-2.0)/1.0, 0, 1)
    f *= 1 + 0.01*np.sin(2*np.pi*5*x)
    ph = 2*np.pi*np.cumsum(f)/SR
    tone = np.sin(ph) + 0.35*np.sin(2*ph) + 0.15*np.sin(3*ph) + bp(white(sec), 800, 3000)*0.08
    out = tone * env_adsr(len(x), 0.25, 0.2, 0.9, 0.9) * 0.4
    return reverb(out, 2.5, 0.45, 0.8)
def owl():
    sec = 1.6; out = np.zeros(int(SR*sec))
    for at, d in ((0.0, 0.35), (0.5, 0.35), (0.85, 0.5)):
        x = t(d); f = 370*(1 - 0.06*x/d)
        tone = np.sin(2*np.pi*np.cumsum(f)/SR) + 0.2*np.sin(4*np.pi*np.cumsum(f)/SR)
        tone = (tone + lp(white(d), 900)*0.15) * env_adsr(len(x), 0.05, 0.08, 0.8, 0.12)
        place(out, tone*0.45, at)
    return out
def crow():
    sec = 1.4; out = np.zeros(int(SR*sec))
    for at in (0.0, 0.45, 0.9):
        c = growl(0.32, 520, 430, ((1200, 1.5), (2600, 1.4)), noise=0.8)
        place(out, c * env_adsr(int(0.32*SR), 0.02, 0.05, 0.9, 0.1), at, 0.8)
    return out
def bones_rattle():
    sec = 1.3; out = np.zeros(int(SR*sec))
    for _ in range(18):
        f = rng.uniform(800, 2200); c = (sine(f, 0.06) + 0.5*sine(f*1.7, 0.06))*expdecay(0.06, 0.01) + bp(white(0.06), 1000, 5000)*expdecay(0.06,0.005)*0.5
        place(out, c, rng.uniform(0, 1.1), rng.uniform(0.3, 1))
    return out

# ---------- music loops ----------
def war_drums(sec=7.5):
    bpm = 96; beat = 60/bpm; out = np.zeros(int(SR*sec))
    big = lambda: soft(sine(48, 0.5)*expdecay(0.5, 0.18)*1.5 + lp(white(0.5), 300)*expdecay(0.5, 0.04), 2)
    tom = lambda: sine(120, 0.3)*expdecay(0.3, 0.08) + lp(white(0.3), 900)*expdecay(0.3, 0.02)*0.5
    pattern = [(0, 'B'), (1, 'B'), (1.5, 'T'), (2, 'B'), (3, 'B'), (3.5, 'T'), (3.75, 'T')]
    bar = 4*beat; pos = 0.0
    while pos < sec - 0.01:
        for off, k in pattern:
            place(out, big() if k == 'B' else tom(), pos + off*beat, 1.0 if k == 'B' else 0.6)
        pos += bar
    return loopify(reverb(out, 1.0, 0.2, 0.3), 0.05)
def tension_drone(sec=24):
    x = t(sec); out = np.zeros_like(x)
    for f, g in ((55, 1), (58.3, 0.5), (110, 0.4), (116.5, 0.3), (164.8, 0.2)):
        out += (saw(f, sec) + saw(f*1.003, sec)) * g * (0.6 + 0.4*np.sin(2*np.pi*0.05*x + f))
    out = lp(out, 600 + 300*np.sin(2*np.pi*0.03*x).mean()) * 0.06
    out += bp(pink(sec), 2000, 6000) * (np.sin(2*np.pi*0.11*x)**8) * 0.05
    return loopify(out)
def mystery_pad(sec=28):
    x = t(sec); out = np.zeros_like(x)
    for f in (146.8, 174.6, 220, 261.6, 329.6):
        for det in (0.997, 1.0, 1.004):
            out += np.sin(2*np.pi*f*det*x + rng.uniform(0, 6)) * (0.5+0.5*np.sin(2*np.pi*rng.uniform(0.02,0.06)*x + rng.uniform(0,6)))
    out = lp(out, 1200) * 0.06 + bp(pink(sec), 3000, 9000)*0.02
    return loopify(reverb(out, 2.5, 0.4, 0.9))

# ---------- catalogue ----------
SOUNDS = [
    # id, name, category, kind, builder, defaultVolume
    ('rain', 'Rain', 'ambience', 'loop', rain, 0.7),
    ('storm', 'Storm', 'ambience', 'loop', storm, 0.7),
    ('wind', 'Wind', 'ambience', 'loop', wind, 0.6),
    ('forest-night', 'Forest at night', 'ambience', 'loop', forest_night, 0.8),
    ('campfire', 'Campfire', 'ambience', 'loop', campfire, 0.7),
    ('dungeon', 'Dungeon', 'ambience', 'loop', dungeon, 0.8),
    ('cave-drone', 'Cave drone', 'ambience', 'loop', cave_drone, 0.7),
    ('ocean', 'Ocean waves', 'ambience', 'loop', ocean, 0.7),
    ('tavern', 'Tavern', 'ambience', 'loop', tavern, 0.8),
    ('heartbeat', 'Heartbeat', 'ambience', 'loop', heartbeat, 0.8),
    ('sword-clash', 'Sword clash', 'combat', 'shot', sword_clash, 1),
    ('heavy-hit', 'Heavy hit', 'combat', 'shot', heavy_hit, 1),
    ('shield-block', 'Shield block', 'combat', 'shot', shield_block, 1),
    ('arrow', 'Arrow', 'combat', 'shot', arrow, 1),
    ('spell-cast', 'Spell cast', 'combat', 'shot', spell_cast, 1),
    ('explosion', 'Explosion', 'combat', 'shot', explosion, 1),
    ('thunder', 'Thunder', 'stingers', 'shot', thunder, 1),
    ('door-creak', 'Door creak', 'stingers', 'shot', door_creak, 1),
    ('door-slam', 'Door slam', 'stingers', 'shot', door_slam, 1),
    ('chest-open', 'Chest open', 'stingers', 'shot', chest_open, 1),
    ('coins', 'Coins', 'stingers', 'shot', coins, 1),
    ('dice-roll', 'Dice roll', 'stingers', 'shot', dice_roll, 1),
    ('footsteps', 'Footsteps', 'stingers', 'shot', footsteps, 1),
    ('bell-toll', 'Bell toll', 'stingers', 'shot', bell_toll, 1),
    ('dramatic-sting', 'Dramatic sting', 'stingers', 'shot', dramatic_sting, 1),
    ('victory-fanfare', 'Victory fanfare', 'stingers', 'shot', victory_fanfare, 1),
    ('horn-call', 'Horn call', 'stingers', 'shot', horn_call, 1),
    ('dragon-roar', 'Dragon roar', 'creatures', 'shot', dragon_roar, 1),
    ('monster-growl', 'Monster growl', 'creatures', 'shot', monster_growl, 1),
    ('wolf-howl', 'Wolf howl', 'creatures', 'shot', wolf_howl, 1),
    ('owl', 'Owl', 'creatures', 'shot', owl, 1),
    ('crow', 'Crow', 'creatures', 'shot', crow, 1),
    ('bones-rattle', 'Bones rattle', 'creatures', 'shot', bones_rattle, 1),
    ('war-drums', 'War drums', 'music', 'loop', war_drums, 0.8),
    ('tension-drone', 'Tension drone', 'music', 'loop', tension_drone, 0.7),
    ('mystery-pad', 'Mystery pad', 'music', 'loop', mystery_pad, 0.7),
]

def write_mp3(path, x):
    import lameenc
    pcm = (np.clip(x, -1, 1) * 32767).astype('<i2').tobytes()
    enc = lameenc.Encoder(); enc.set_bit_rate(112); enc.set_in_sample_rate(SR); enc.set_channels(1); enc.set_quality(2)
    with open(path, 'wb') as f: f.write(enc.encode(pcm)); f.write(enc.flush())
def write_wav(path, x):
    import wave
    with wave.open(path, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes((np.clip(x, -1, 1)*32767).astype('<i2').tobytes())

def main():
    os.makedirs(OUT, exist_ok=True)
    use_wav = '--wav' in sys.argv
    ext = 'wav' if use_wav else 'mp3'
    manifest_path = os.path.join(OUT, 'manifest.json')
    existing = {}
    if os.path.exists(manifest_path):
        for e in json.load(open(manifest_path)):
            existing[e['id']] = e
    manifest = []
    for sid, name, cat, kind, fn, vol in SOUNDS:
        prev = existing.get(sid)
        if prev and prev.get('source', {}).get('fetched'):
            manifest.append(prev)     # keep a real sound the fetch script dropped in
            print(f'keep   {sid} (fetched)'); continue
        x = normalize(fn(), peak=0.89 if kind == "loop" else 0.72)
        # loops: settle level a bit lower than shots so ambience doesn't swamp stingers
        if kind == 'loop': x = x * 0.7
        path = os.path.join(OUT, f'{sid}.{ext}')
        (write_wav if use_wav else write_mp3)(path, x)
        manifest.append({
            'id': sid, 'name': name, 'category': cat, 'kind': kind, 'file': f'sounds/{sid}.{ext}',
            'gain': 1.0, 'defaultVolume': vol,
            'source': {'title': f'{name} (synthesized)', 'author': 'Dandanaka generator', 'license': 'CC0 1.0', 'url': 'https://creativecommons.org/publicdomain/zero/1.0/'},
        })
        print(f'wrote  {path} ({len(x)/SR:.1f}s)')
    json.dump(manifest, open(manifest_path, 'w'), indent=2)
    print(f'manifest: {len(manifest)} sounds')

if __name__ == '__main__':
    main()
