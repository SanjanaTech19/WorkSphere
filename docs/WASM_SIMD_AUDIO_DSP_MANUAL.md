# WebAssembly SIMD Audio Noise Cancellation and DSP Manual

This guide documents a production-oriented architecture for running C++ digital
signal processing code in WebAssembly, passing audio buffers through an
`AudioWorkletProcessor`, performing FFT-based spectrum analysis, and applying
real-time noise suppression in WorkSphere.

> Scope:
>
> - C++ DSP compiled with Emscripten
> - WebAssembly SIMD (`wasm_simd128`)
> - AudioWorklet-based real-time processing
> - FFT spectrum analysis
> - Noise estimation and suppression
> - Shared memory and aligned buffers
> - Latency measurement and benchmarking
> - Browser compatibility and graceful fallback

---

## 1. Recommended architecture

```text
Microphone
   │
   ▼
MediaStreamAudioSourceNode
   │
   ▼
AudioWorkletNode
   │
   ├── AudioWorkletProcessor
   │      ├── input/output Float32Array blocks
   │      ├── WebAssembly DSP instance
   │      ├── FFT + noise estimator
   │      └── suppression / gain stage
   │
   ├── MessagePort ───────► UI metrics and controls
   │
   ▼
Destination / recorder / analyser
```

The real-time processing path should remain inside the audio rendering thread.
The main browser thread should only:

- request microphone access;
- load the worklet module;
- configure controls;
- display metrics;
- handle non-real-time UI work.

Avoid moving every audio block through the main thread because message passing,
allocation, and scheduling jitter can create audible dropouts.

---

## 2. Toolchain requirements

Recommended development environment:

```text
Emscripten SDK: current stable release
C++ standard: C++20 or newer
CMake: 3.20+
Node.js: project-supported LTS release
Browser: current Chromium, Firefox, or Safari with AudioWorklet support
```

Install and activate Emscripten:

```bash
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk
./emsdk install latest
./emsdk activate latest
source ./emsdk_env.sh
```

Windows PowerShell:

```powershell
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk
.\emsdk install latest
.\emsdk activate latest
.\emsdk_env.ps1
```

Verify:

```bash
emcc --version
em++ --version
```

---

## 3. C++ DSP interface

Keep the exported interface small and allocation-free during processing.

```cpp
// dsp_processor.h
#pragma once

#include <cstddef>
#include <cstdint>

class DspProcessor {
 public:
  DspProcessor(std::uint32_t sample_rate,
               std::uint32_t frame_size,
               std::uint32_t channels);

  void reset() noexcept;

  void set_suppression_strength(float value) noexcept;
  void set_noise_floor_db(float value) noexcept;

  void process(const float* input,
               float* output,
               std::size_t frames) noexcept;

  float last_input_rms() const noexcept;
  float last_output_rms() const noexcept;
  float estimated_noise_db() const noexcept;

 private:
  std::uint32_t sample_rate_;
  std::uint32_t frame_size_;
  std::uint32_t channels_;

  float suppression_strength_ = 0.65F;
  float noise_floor_db_ = -55.0F;
  float last_input_rms_ = 0.0F;
  float last_output_rms_ = 0.0F;
  float estimated_noise_db_ = -90.0F;
};
```

Export a C-compatible wrapper:

```cpp
// bindings.cpp
#include "dsp_processor.h"

#include <emscripten/emscripten.h>

extern "C" {

EMSCRIPTEN_KEEPALIVE
DspProcessor* dsp_create(std::uint32_t sample_rate,
                         std::uint32_t frame_size,
                         std::uint32_t channels) {
  return new DspProcessor(sample_rate, frame_size, channels);
}

EMSCRIPTEN_KEEPALIVE
void dsp_destroy(DspProcessor* processor) {
  delete processor;
}

EMSCRIPTEN_KEEPALIVE
void dsp_process(DspProcessor* processor,
                 const float* input,
                 float* output,
                 std::size_t frames) {
  if (!processor || !input || !output) {
    return;
  }

  processor->process(input, output, frames);
}

EMSCRIPTEN_KEEPALIVE
void dsp_set_suppression_strength(DspProcessor* processor, float value) {
  if (processor) {
    processor->set_suppression_strength(value);
  }
}

}
```

### Real-time safety rules

The `process()` method should not:

- allocate memory;
- resize containers;
- lock a mutex;
- print logs;
- access files;
- make network requests;
- throw exceptions;
- call JavaScript;
- perform unbounded work.

Preallocate FFT buffers, window coefficients, overlap state, and scratch memory
during initialization.

---

## 4. Emscripten SIMD build flags

Compile WebAssembly SIMD with:

```bash
em++ \
  src/dsp_processor.cpp \
  src/bindings.cpp \
  -O3 \
  -std=c++20 \
  -msimd128 \
  -fno-exceptions \
  -fno-rtti \
  -s WASM=1 \
  -s MODULARIZE=1 \
  -s EXPORT_ES6=1 \
  -s ENVIRONMENT=web,worker \
  -s ALLOW_MEMORY_GROWTH=0 \
  -s INITIAL_MEMORY=16777216 \
  -s EXPORTED_FUNCTIONS='["_malloc","_free","_dsp_create","_dsp_destroy","_dsp_process","_dsp_set_suppression_strength"]' \
  -s EXPORTED_RUNTIME_METHODS='["HEAPF32"]' \
  -o public/audio/dsp-module.js
```

Important flags:

| Flag                       | Purpose                                                   |
| -------------------------- | --------------------------------------------------------- |
| `-O3`                      | Optimizes hot DSP loops                                   |
| `-msimd128`                | Enables WebAssembly 128-bit SIMD                          |
| `-fno-exceptions`          | Avoids exception overhead when exceptions are unnecessary |
| `-fno-rtti`                | Removes RTTI overhead when unused                         |
| `MODULARIZE=1`             | Generates a module factory                                |
| `EXPORT_ES6=1`             | Generates an ES module                                    |
| `ENVIRONMENT=web,worker`   | Supports worklet/worker-like environments                 |
| `ALLOW_MEMORY_GROWTH=0`    | Keeps memory stable during real-time processing           |
| `INITIAL_MEMORY`           | Preallocates enough linear memory                         |
| `EXPORTED_FUNCTIONS`       | Exposes native functions                                  |
| `EXPORTED_RUNTIME_METHODS` | Exposes selected runtime helpers                          |

### Why disable memory growth?

Growing WebAssembly memory can replace the underlying buffer and invalidate
typed-array views. A real-time processor should preallocate memory and avoid
growth during audio rendering.

Choose `INITIAL_MEMORY` after measuring:

- FFT buffers;
- overlap buffers;
- model/state memory;
- input and output staging buffers;
- worst-case channel count;
- safety headroom.

---

## 5. SIMD feature detection

Do not assume SIMD support without detection.

```ts
export async function supportsWasmSimd(): Promise<boolean> {
  const simdProbe = new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x05, 0x01, 0x60,
    0x00, 0x01, 0x7b, 0x03, 0x02, 0x01, 0x00, 0x0a, 0x0a, 0x01, 0x08, 0x00,
    0xfd, 0x0c, 0x00, 0x00, 0x00, 0x00, 0x0b,
  ]);

  return WebAssembly.validate(simdProbe);
}
```

Recommended deployment:

```text
dsp-module-simd.wasm
dsp-module-scalar.wasm
```

Select at runtime:

```ts
const simd = await supportsWasmSimd();

const moduleUrl = simd
  ? "/audio/dsp-module-simd.js"
  : "/audio/dsp-module-scalar.js";
```

The scalar build should omit `-msimd128`.

---

## 6. Aligned memory rules

WebAssembly SIMD vectors are 128 bits wide. Align hot float buffers to at least
16 bytes.

C++ aligned allocation:

```cpp
#include <cstdlib>
#include <new>

float* allocate_aligned_floats(std::size_t count) {
  const std::size_t bytes = count * sizeof(float);
  const std::size_t alignment = 16;

  void* pointer = nullptr;

#if defined(_MSC_VER)
  pointer = _aligned_malloc(bytes, alignment);
  if (!pointer) {
    throw std::bad_alloc();
  }
#else
  if (posix_memalign(&pointer, alignment, bytes) != 0) {
    throw std::bad_alloc();
  }
#endif

  return static_cast<float*>(pointer);
}
```

For Emscripten-only code, aligned storage can also be represented with:

```cpp
alignas(16) float input_buffer[2048];
alignas(16) float output_buffer[2048];
```

### Alignment checklist

- Align SIMD input and output buffers to 16 bytes.
- Keep FFT real/imaginary arrays aligned.
- Avoid packed structs for SIMD data.
- Verify pointer arithmetic preserves alignment.
- Avoid reinterpreting unaligned byte buffers as vectors.
- Use scalar handling for remaining samples when the frame count is not a
  multiple of the SIMD lane width.
- Test with debug and sanitizing builds before enabling aggressive optimization.

Do not assume JavaScript-owned typed-array byte offsets are aligned unless you
control the allocation offset.

---

## 7. SIMD processing example

```cpp
#include <wasm_simd128.h>

void apply_gain_simd(const float* input,
                     float* output,
                     std::size_t sample_count,
                     float gain) noexcept {
  const v128_t gain_vector = wasm_f32x4_splat(gain);

  std::size_t index = 0;

  for (; index + 4 <= sample_count; index += 4) {
    const v128_t samples = wasm_v128_load(input + index);
    const v128_t scaled = wasm_f32x4_mul(samples, gain_vector);
    wasm_v128_store(output + index, scaled);
  }

  for (; index < sample_count; index += 1) {
    output[index] = input[index] * gain;
  }
}
```

SIMD is most useful for:

- window multiplication;
- vector gain;
- spectral magnitude operations;
- noise mask calculations;
- overlap-add;
- filters with contiguous vectorizable data.

Always benchmark. A SIMD rewrite can be slower when data shuffling dominates.

---

## 8. Loading WebAssembly in an AudioWorklet

The AudioWorklet global scope is separate from the page's main JavaScript
context. Load or pass the compiled module deliberately.

Main thread:

```ts
const context = new AudioContext({
  latencyHint: "interactive",
});

await context.audioWorklet.addModule("/audio/noise-suppression-processor.js");

const response = await fetch("/audio/dsp-module-simd.wasm");
const wasmBytes = await response.arrayBuffer();

const node = new AudioWorkletNode(context, "noise-suppression-processor", {
  numberOfInputs: 1,
  numberOfOutputs: 1,
  outputChannelCount: [1],
  processorOptions: {
    wasmBytes,
    sampleRate: context.sampleRate,
  },
});
```

Passing a compiled `WebAssembly.Module` may be preferable where structured
cloning support is reliable:

```ts
const module = await WebAssembly.compile(wasmBytes);
```

Then include it in `processorOptions`.

Avoid fetching the WASM file from inside every worklet instance.

---

## 9. AudioWorkletProcessor skeleton

```js
class NoiseSuppressionProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();

    this.ready = false;
    this.enabled = true;
    this.strength = 0.65;

    this.initialize(options.processorOptions).catch((error) => {
      this.port.postMessage({
        type: "error",
        message: error instanceof Error ? error.message : "WASM init failed",
      });
    });

    this.port.onmessage = (event) => {
      const message = event.data;

      if (message?.type === "set-enabled") {
        this.enabled = Boolean(message.value);
      }

      if (message?.type === "set-strength") {
        this.strength = Math.max(0, Math.min(1, Number(message.value)));
        this.updateStrength();
      }
    };
  }

  async initialize(options) {
    const result = await WebAssembly.instantiate(options.wasmBytes, {
      env: {},
    });

    this.exports = result.instance.exports;
    this.memory = this.exports.memory;

    this.frameCapacity = 2048;
    this.inputPointer = this.exports.malloc(
      this.frameCapacity * Float32Array.BYTES_PER_ELEMENT,
    );
    this.outputPointer = this.exports.malloc(
      this.frameCapacity * Float32Array.BYTES_PER_ELEMENT,
    );

    this.processorPointer = this.exports.dsp_create(
      options.sampleRate,
      this.frameCapacity,
      1,
    );

    this.refreshHeapViews();
    this.updateStrength();
    this.ready = true;

    this.port.postMessage({ type: "ready" });
  }

  refreshHeapViews() {
    this.inputView = new Float32Array(
      this.memory.buffer,
      this.inputPointer,
      this.frameCapacity,
    );

    this.outputView = new Float32Array(
      this.memory.buffer,
      this.outputPointer,
      this.frameCapacity,
    );
  }

  updateStrength() {
    if (this.processorPointer && this.exports) {
      this.exports.dsp_set_suppression_strength(
        this.processorPointer,
        this.strength,
      );
    }
  }

  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];

    if (!output) {
      return true;
    }

    if (!input || !this.ready || !this.enabled) {
      if (input) {
        output.set(input);
      } else {
        output.fill(0);
      }

      return true;
    }

    const frames = Math.min(input.length, output.length, this.frameCapacity);

    this.inputView.set(input.subarray(0, frames));

    this.exports.dsp_process(
      this.processorPointer,
      this.inputPointer,
      this.outputPointer,
      frames,
    );

    output.set(this.outputView.subarray(0, frames));

    return true;
  }
}

registerProcessor("noise-suppression-processor", NoiseSuppressionProcessor);
```

### Important buffer rule

Read the actual input/output array length each callback. Do not hard-code the
render quantum size into correctness-sensitive code.

The processor should return `true` while it must remain active.

---

## 10. Buffer passing strategies

## 10.1 Copy into WASM linear memory

The simplest reliable method:

1. copy `Float32Array` input into WASM memory;
2. run DSP;
3. copy output back.

Advantages:

- simple ownership;
- predictable memory;
- broad compatibility.

Disadvantages:

- two copies per block;
- additional memory bandwidth.

For small render blocks, this may still be fast enough.

## 10.2 SharedArrayBuffer ring buffer

A shared ring buffer can reduce repeated copies between a worker and worklet,
but requires:

- cross-origin isolation;
- `SharedArrayBuffer`;
- `Atomics`;
- careful producer/consumer design;
- overrun and underrun handling.

Required headers generally include:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Conceptual ring state:

```ts
type RingBufferState = {
  samples: Float32Array;
  indices: Int32Array;
};

// indices[0] = write position
// indices[1] = read position
```

The AudioWorklet must never block waiting for samples. On underrun, use a safe
fallback such as silence or bypassed audio.

## 10.3 MessagePort

Use `port.postMessage()` for:

- configuration;
- FFT summaries;
- RMS levels;
- benchmark statistics;
- errors;
- lifecycle state.

Do not send every full-resolution audio block to the UI.

---

## 11. FFT spectrum analysis

A typical short-time Fourier transform pipeline:

```text
audio frame
   │
   ├── remove DC
   ├── apply Hann window
   ├── FFT
   ├── compute magnitude/power spectrum
   ├── update noise estimate
   ├── calculate suppression gain
   ├── apply gain to complex bins
   ├── inverse FFT
   └── overlap-add
```

### FFT size

Typical choices:

| FFT size | Trade-off                                               |
| -------: | ------------------------------------------------------- |
|      256 | Low latency, poor frequency resolution                  |
|      512 | Good speech compromise                                  |
|     1024 | Better frequency resolution, more latency               |
|     2048 | Higher analysis resolution, larger latency and CPU cost |

At 48 kHz:

```text
512 samples ≈ 10.67 ms
1024 samples ≈ 21.33 ms
2048 samples ≈ 42.67 ms
```

A 50% overlap reduces hop size while preserving analysis resolution.

### Hann window

```cpp
#include <cmath>
#include <vector>

std::vector<float> create_hann_window(std::size_t size) {
  std::vector<float> window(size);

  for (std::size_t index = 0; index < size; index += 1) {
    window[index] =
        0.5F -
        0.5F *
            std::cos(
                (2.0F * static_cast<float>(M_PI) * index) /
                static_cast<float>(size - 1));
  }

  return window;
}
```

Precompute the window once.

### Spectrum magnitude

For complex FFT output:

```cpp
float power = real * real + imag * imag;
float magnitude = std::sqrt(power);
float decibels = 10.0F * std::log10(power + 1.0e-12F);
```

Use a small epsilon to avoid `log(0)`.

---

## 12. Noise estimation

A basic noise estimator updates during speech-absent or low-energy periods.

```cpp
noise[k] =
    alpha * noise[k] +
    (1.0F - alpha) * current_power[k];
```

Where:

```text
alpha ≈ 0.90 to 0.995
```

A larger alpha updates more slowly.

Better estimators can use:

- minimum statistics;
- quantile tracking;
- voice activity detection;
- speech-presence probability;
- separate attack and release rates.

Do not update the noise model aggressively during active speech, or the
processor may learn speech as noise.

---

## 13. Spectral suppression

Simple Wiener-like gain:

```cpp
float posterior_snr =
    signal_power /
    std::max(noise_power, epsilon);

float gain =
    posterior_snr /
    (1.0F + posterior_snr);
```

Apply limits:

```cpp
gain = std::clamp(gain, minimum_gain, 1.0F);
```

Blend with user strength:

```cpp
gain =
    1.0F -
    strength * (1.0F - gain);
```

### Avoiding musical noise

Hard zeroing of FFT bins causes unstable tonal artifacts.

Use:

- a non-zero minimum gain;
- temporal smoothing;
- frequency smoothing;
- decision-directed SNR estimation;
- gentle attenuation rather than binary masks;
- attack/release envelopes.

Example smoothing:

```cpp
smoothed_gain[k] =
    attack_release *
        previous_gain[k] +
    (1.0F - attack_release) *
        current_gain[k];
```

---

## 14. Time-domain fallback suppressor

Provide a low-cost fallback when WASM or SIMD initialization fails.

```js
function applyNoiseGate(input, output, threshold, attenuation) {
  for (let index = 0; index < input.length; index += 1) {
    const sample = input[index];
    const amplitude = Math.abs(sample);

    output[index] = amplitude < threshold ? sample * attenuation : sample;
  }
}
```

This is not equivalent to spectral noise suppression, but it provides graceful
degradation.

Fallback order:

```text
SIMD WASM DSP
   ↓ unavailable
scalar WASM DSP
   ↓ unavailable
lightweight JavaScript DSP
   ↓ unavailable
clean bypass
```

Never fail by producing uncontrolled noise or NaN samples.

---

## 15. Audio parameter control

Use `AudioParam` for sample-accurate values where appropriate.

```js
class NoiseSuppressionProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {
        name: "strength",
        defaultValue: 0.65,
        minValue: 0,
        maxValue: 1,
        automationRate: "k-rate",
      },
    ];
  }

  process(inputs, outputs, parameters) {
    const strength = parameters.strength[0];
    // Apply to native processor.
    return true;
  }
}
```

Use `MessagePort` for infrequent structural settings.

---

## 16. Latency budget

Total perceived latency includes:

```text
input hardware latency
+ browser input buffering
+ analysis window / overlap delay
+ DSP processing time
+ output buffering
+ output hardware latency
```

Algorithmic latency is commonly dominated by the FFT window and overlap model.

Approximate FFT window time:

```text
latency_ms = FFT_size / sample_rate × 1000
```

For 1024 samples at 48 kHz:

```text
≈ 21.33 ms
```

Actual end-to-end latency will be higher.

---

## 17. Benchmark harness

Measure processing duration independently from UI rendering.

```js
class NoiseSuppressionProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super(options);
    this.framesProcessed = 0;
    this.processingTimeMs = 0;
    this.lastReportFrame = 0;
  }

  process(inputs, outputs) {
    const startedAt = currentTime;

    // DSP processing...

    const input = inputs[0]?.[0];
    const frames = input?.length ?? 0;

    this.framesProcessed += frames;

    // currentTime is audio timeline time, not a high-resolution CPU timer.
    // For detailed microbenchmarks, benchmark the WASM function separately.

    if (this.framesProcessed - this.lastReportFrame >= sampleRate) {
      this.port.postMessage({
        type: "metrics",
        framesProcessed: this.framesProcessed,
      });
      this.lastReportFrame = this.framesProcessed;
    }

    return true;
  }
}
```

Main-thread offline benchmark:

```ts
export function benchmarkProcessor(
  processBlock: (input: Float32Array, output: Float32Array) => void,
  blockSize = 128,
  iterations = 20_000,
) {
  const input = new Float32Array(blockSize);
  const output = new Float32Array(blockSize);

  for (let index = 0; index < input.length; index += 1) {
    input[index] = Math.sin((2 * Math.PI * index) / blockSize);
  }

  for (let warmup = 0; warmup < 1_000; warmup += 1) {
    processBlock(input, output);
  }

  const startedAt = performance.now();

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    processBlock(input, output);
  }

  const elapsedMs = performance.now() - startedAt;

  return {
    totalMs: elapsedMs,
    averageBlockMs: elapsedMs / iterations,
    realtimeBudgetMs: (blockSize / 48_000) * 1_000,
  };
}
```

At 48 kHz with a 128-frame block, the approximate processing deadline is:

```text
128 / 48000 × 1000 ≈ 2.67 ms
```

DSP processing must remain comfortably below the block deadline to leave room
for browser and graph overhead.

---

## 18. Benchmark matrix

Record at least:

| Build               |  FFT | Channels | Sample rate | Average block time |     p95 |     p99 | Dropouts |
| ------------------- | ---: | -------: | ----------: | -----------------: | ------: | ------: | -------: |
| Scalar WASM         |  512 |        1 |      48 kHz |            Measure | Measure | Measure |  Measure |
| SIMD WASM           |  512 |        1 |      48 kHz |            Measure | Measure | Measure |  Measure |
| Scalar WASM         | 1024 |        1 |      48 kHz |            Measure | Measure | Measure |  Measure |
| SIMD WASM           | 1024 |        1 |      48 kHz |            Measure | Measure | Measure |  Measure |
| JavaScript fallback |  512 |        1 |      48 kHz |            Measure | Measure | Measure |  Measure |

Do not publish invented latency numbers. Benchmark on representative desktop
and mobile hardware.

### Suggested acceptance targets

Treat these as initial engineering targets, not guaranteed figures:

- no audible dropouts during a 10-minute test;
- average processing time below 25% of the audio block deadline;
- p99 below 60% of the deadline;
- no memory growth during steady-state processing;
- no allocation spikes in the audio callback;
- scalar fallback remains functional.

---

## 19. Measuring audio quality

Performance alone is insufficient.

Measure:

- input/output RMS;
- estimated noise floor;
- speech attenuation;
- signal-to-noise ratio improvement;
- spectral distortion;
- clipping rate;
- NaN/Infinity occurrence;
- subjective musical-noise artifacts.

Test signals:

- stationary fan noise;
- café background noise;
- keyboard clicks;
- air conditioner hum;
- speech plus broadband noise;
- silence;
- clipping-level speech;
- sudden transient noise.

Always include a bypass comparison.

---

## 20. Memory lifecycle

Allocate once:

```js
this.inputPointer = exports.malloc(inputBytes);
this.outputPointer = exports.malloc(outputBytes);
```

Release when the node is permanently destroyed, where lifecycle permits:

```js
exports.dsp_destroy(this.processorPointer);
exports.free(this.inputPointer);
exports.free(this.outputPointer);
```

Because AudioWorklet processor destruction is controlled by the browser,
design cleanup messages carefully and avoid creating processors repeatedly.

### Typed-array invalidation

If WASM memory can grow, recreate views when:

```js
this.inputView.buffer !== this.memory.buffer;
```

Recommended real-time configuration avoids growth entirely.

---

## 21. Error and safety handling

Validate every processed block:

```js
for (let index = 0; index < output.length; index += 1) {
  if (!Number.isFinite(output[index])) {
    output[index] = 0;
  }

  output[index] = Math.max(-1, Math.min(1, output[index]));
}
```

Production code may use a faster vectorized limiter, but the same invariants
apply.

On initialization failure:

1. notify the main thread;
2. enter bypass mode;
3. keep returning `true`;
4. avoid repeated initialization attempts inside `process()`.

---

## 22. Security and privacy

Microphone audio is sensitive.

Requirements:

- process locally by default;
- request microphone permission only after user action;
- clearly indicate active capture;
- provide stop and bypass controls;
- avoid logging raw samples;
- do not upload audio without explicit consent;
- do not retain FFT data longer than necessary;
- validate worklet and WASM asset origins;
- serve assets over HTTPS in production;
- apply cross-origin isolation only after reviewing third-party resources.

---

## 23. Browser and deployment requirements

AudioWorklet requires a secure context in production.

Recommended asset headers:

```text
Content-Type: application/wasm
Cache-Control: public, max-age=31536000, immutable
```

Version hashed WASM filenames so immutable caching is safe.

When using `SharedArrayBuffer`, configure cross-origin isolation and ensure all
embedded resources are compatible with those headers.

---

## 24. Next.js integration

Public assets:

```text
public/
└── audio/
    ├── dsp-module-simd.js
    ├── dsp-module-simd.wasm
    ├── dsp-module-scalar.js
    ├── dsp-module-scalar.wasm
    └── noise-suppression-processor.js
```

Client hook:

```ts
"use client";

import { useRef, useState } from "react";

export function useNoiseSuppression() {
  const contextRef = useRef<AudioContext | null>(null);
  const nodeRef = useRef<AudioWorkletNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState<"idle" | "starting" | "ready" | "error">(
    "idle",
  );

  async function start() {
    setStatus("starting");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          autoGainControl: false,
          noiseSuppression: false,
        },
      });

      const context = new AudioContext({
        latencyHint: "interactive",
      });

      await context.audioWorklet.addModule(
        "/audio/noise-suppression-processor.js",
      );

      const wasmResponse = await fetch("/audio/dsp-module-simd.wasm");
      const wasmBytes = await wasmResponse.arrayBuffer();

      const source = context.createMediaStreamSource(stream);

      const node = new AudioWorkletNode(
        context,
        "noise-suppression-processor",
        {
          processorOptions: {
            wasmBytes,
            sampleRate: context.sampleRate,
          },
        },
      );

      source.connect(node);
      node.connect(context.destination);

      contextRef.current = context;
      nodeRef.current = node;
      streamRef.current = stream;

      setEnabled(true);
      setStatus("ready");
    } catch (error) {
      console.error("[NoiseSuppression] Unable to start", error);
      setStatus("error");
    }
  }

  async function stop() {
    nodeRef.current?.disconnect();

    streamRef.current?.getTracks().forEach((track) => track.stop());

    await contextRef.current?.close();

    nodeRef.current = null;
    streamRef.current = null;
    contextRef.current = null;

    setEnabled(false);
    setStatus("idle");
  }

  return {
    enabled,
    status,
    start,
    stop,
  };
}
```

Do not connect processed microphone audio directly to speakers in a normal
product flow without headphones, or acoustic feedback may occur.

---

## 25. Testing checklist

### Build

- [ ] SIMD and scalar WASM artifacts compile.
- [ ] WASM MIME type is correct.
- [ ] exported function names match JavaScript usage.
- [ ] production optimization is enabled.
- [ ] no memory growth occurs in steady state.

### AudioWorklet

- [ ] processor loads through `audioWorklet.addModule()`.
- [ ] initialization failure enters bypass mode.
- [ ] variable input lengths are handled.
- [ ] missing input produces silence safely.
- [ ] `process()` returns the intended lifecycle value.
- [ ] MessagePort control updates work.

### DSP

- [ ] silence remains stable.
- [ ] output contains no NaN or Infinity values.
- [ ] clipping is bounded.
- [ ] stationary noise is reduced.
- [ ] speech remains intelligible.
- [ ] musical noise is acceptable.
- [ ] scalar and SIMD outputs are numerically close.

### Performance

- [ ] benchmark includes warm-up.
- [ ] average, p95, and p99 are recorded.
- [ ] desktop and mobile hardware are tested.
- [ ] 10-minute dropout test passes.
- [ ] FFT sizes are compared.
- [ ] CPU and memory remain stable.

### Privacy

- [ ] capture starts only after user action.
- [ ] active microphone state is visible.
- [ ] stop control releases all tracks.
- [ ] raw audio is not logged or uploaded unexpectedly.

---

## 26. Troubleshooting

### `CompileError: invalid opcode`

Likely cause: SIMD WASM loaded on a browser without SIMD support.

Resolution:

- perform feature detection;
- load the scalar build.

### `SharedArrayBuffer is not defined`

Likely cause: the page is not cross-origin isolated.

Resolution:

- configure COOP/COEP headers;
- verify third-party assets;
- use copy-based buffering as fallback.

### Audio crackles or drops

Check:

- allocations in `process()`;
- WASM memory growth;
- excessive FFT size;
- logging in the worklet;
- full-buffer MessagePort transfers;
- CPU throttling;
- processing time relative to block deadline.

### WASM typed arrays show stale memory

Cause: the memory buffer changed after growth.

Resolution:

- disable memory growth;
- or recreate typed-array views whenever the memory buffer changes.

### Processor produces silence

Check:

- input channel existence;
- function export names;
- pointer offsets;
- frame capacity;
- output copy;
- processor readiness;
- sample format and channel count.

### Strong musical noise

Adjust:

- gain floor;
- temporal smoothing;
- frequency smoothing;
- noise estimator update rate;
- FFT size and overlap;
- suppression strength.

---

## 27. Pull-request review checklist

- [ ] SIMD build has a scalar fallback.
- [ ] DSP code is allocation-free during processing.
- [ ] hot buffers are aligned to 16 bytes.
- [ ] WASM memory is preallocated.
- [ ] AudioWorklet reads actual buffer lengths.
- [ ] no external calls occur inside `process()`.
- [ ] MessagePort traffic is bounded.
- [ ] FFT window and overlap are documented.
- [ ] benchmark results use real measurements.
- [ ] privacy and microphone lifecycle are documented.
- [ ] bypass behavior is safe.
- [ ] browser compatibility is tested.

---

## 28. Summary

The recommended WorkSphere implementation uses:

```text
C++ DSP
  + Emscripten
  + -msimd128
  + fixed WASM memory
  + 16-byte-aligned buffers
  + AudioWorkletProcessor
  + FFT-based noise estimation
  + smoothed spectral gain
  + scalar and JavaScript fallback
```

Keep the audio callback deterministic, allocation-free, and comfortably below
the render deadline. Benchmark on real hardware and publish measured rather
than estimated latency values.
