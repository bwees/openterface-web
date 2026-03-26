<script lang="ts">
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import * as Popover from '$lib/components/ui/popover';
  import { Separator } from '$lib/components/ui/separator';
  import { Switch } from '$lib/components/ui/switch';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import { buildGetInfoFrame } from '$lib/serial/protocol';
  import { kvm } from '$lib/stores/kvm.svelte';
  import { detectCropInsets, type CropInsets } from '$lib/video/autocrop';
  import {
    ArrowsUpFromLine,
    ClipboardPaste,
    Info,
    Keyboard,
    Maximize,
    Monitor,
    Mouse,
    Play,
    Plug,
    Plus,
    RefreshCw,
    Trash2,
    TriangleAlert,
    Unplug,
    Video,
    VideoOff,
    X,
  } from '@lucide/svelte';
  import { HID_KEY } from '$lib/serial/hid-keycodes';
  import { onMount } from 'svelte';

  let videoEl: HTMLVideoElement | undefined = $state();
  let videoContainerEl: HTMLDivElement | undefined = $state();

  // Auto-crop state — insets are fractions (0..1)
  let cropInsets = $state<CropInsets>({ top: 0, bottom: 0, left: 0, right: 0 });
  let cropCanvas: HTMLCanvasElement | undefined;
  let cropInterval: ReturnType<typeof setInterval> | undefined;

  // Container / video dimensions for crop display and mouse mapping
  let containerWidth = $state(0);
  let containerHeight = $state(0);
  let videoNativeWidth = $state(0);
  let videoNativeHeight = $state(0);

  // Snippet form
  let newSnippetName = $state('');
  let newSnippetText = $state('');
  let showSnippetForm = $state(false);

  // Connection status derived
  let connectionCount = $derived((kvm.connected ? 1 : 0) + (kvm.videoStream ? 1 : 0));

  onMount(() => {
    document.addEventListener('pointerlockchange', onPointerLockChange);
  });

  // Load persisted state on mount
  $effect(() => {
    kvm.loadPersistedState();
    kvm.refreshVideoDevices();
    return () => {
      if (cropInterval) clearInterval(cropInterval);
    };
  });

  // Track container dimensions via ResizeObserver
  $effect(() => {
    if (!videoContainerEl) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        containerWidth = entry.contentRect.width;
        containerHeight = entry.contentRect.height;
      }
    });
    observer.observe(videoContainerEl);
    return () => observer.disconnect();
  });

  // Bind video stream to element
  $effect(() => {
    if (videoEl && kvm.videoStream) {
      videoEl.srcObject = kvm.videoStream;
    } else if (videoEl) {
      videoEl.srcObject = null;
    }
  });

  // Auto-crop detection loop — only runs when enabled
  $effect(() => {
    if (cropInterval) {
      clearInterval(cropInterval);
      cropInterval = undefined;
    }

    if (!kvm.autoCropEnabled || !kvm.videoStream || !videoEl) {
      return;
    }

    if (!cropCanvas) {
      cropCanvas = document.createElement('canvas');
    }

    const runDetection = () => {
      if (videoEl && videoEl.readyState >= 2 && kvm.autoCropEnabled) {
        cropInsets = detectCropInsets(videoEl, cropCanvas!);
      }
    };

    if (videoEl.readyState >= 2) {
      runDetection();
      cropInterval = setInterval(runDetection, 2000);
    } else {
      const handler = () => {
        runDetection();
        cropInterval = setInterval(runDetection, 2000);
      };
      videoEl.addEventListener('loadeddata', handler, { once: true });
    }
  });

  // Clear crop insets immediately when autoCrop is toggled off
  $effect(() => {
    if (!kvm.autoCropEnabled) {
      cropInsets = { top: 0, bottom: 0, left: 0, right: 0 };
    }
  });

  // Crop detection derived
  let hasCrop = $derived(
    kvm.autoCropEnabled &&
      (cropInsets.top > 0.005 ||
        cropInsets.bottom > 0.005 ||
        cropInsets.left > 0.005 ||
        cropInsets.right > 0.005),
  );

  // Compute explicit video sizing — always size to exact content (no letterbox in element)
  let videoStyle = $derived.by(() => {
    if (!videoNativeWidth || !videoNativeHeight || !containerWidth || !containerHeight) return '';

    const contentW = hasCrop ? 1 - cropInsets.left - cropInsets.right : 1;
    const contentH = hasCrop ? 1 - cropInsets.top - cropInsets.bottom : 1;
    if (contentW <= 0.01 || contentH <= 0.01) return '';

    const contentPixW = videoNativeWidth * contentW;
    const contentPixH = videoNativeHeight * contentH;

    const scale = Math.min(containerWidth / contentPixW, containerHeight / contentPixH);

    const renderedVideoW = videoNativeWidth * scale;
    const renderedVideoH = videoNativeHeight * scale;
    const renderedContentW = contentPixW * scale;
    const renderedContentH = contentPixH * scale;

    const contentOffsetX = (containerWidth - renderedContentW) / 2;
    const contentOffsetY = (containerHeight - renderedContentH) / 2;
    const videoLeft = contentOffsetX - (hasCrop ? cropInsets.left * renderedVideoW : 0);
    const videoTop = contentOffsetY - (hasCrop ? cropInsets.top * renderedVideoH : 0);

    return `position:absolute;left:${videoLeft.toFixed(1)}px;top:${videoTop.toFixed(1)}px;width:${renderedVideoW.toFixed(1)}px;height:${renderedVideoH.toFixed(1)}px;`;
  });

  // Compute the viewport rect of the visible content area for mouse coordinate mapping
  function getContentRect(): { left: number; top: number; width: number; height: number } {
    if (!videoContainerEl || !videoNativeWidth || !videoNativeHeight) {
      const fb = videoContainerEl?.getBoundingClientRect();
      return fb ?? { left: 0, top: 0, width: 1, height: 1 };
    }

    const container = videoContainerEl.getBoundingClientRect();
    const contentW = hasCrop ? 1 - cropInsets.left - cropInsets.right : 1;
    const contentH = hasCrop ? 1 - cropInsets.top - cropInsets.bottom : 1;

    const contentPixW = videoNativeWidth * contentW;
    const contentPixH = videoNativeHeight * contentH;
    const contentAspect = contentPixW / contentPixH;
    const containerAspect = container.width / container.height;

    let renderedW: number, renderedH: number;
    if (contentAspect > containerAspect) {
      renderedW = container.width;
      renderedH = container.width / contentAspect;
    } else {
      renderedH = container.height;
      renderedW = container.height * contentAspect;
    }

    return {
      left: container.left + (container.width - renderedW) / 2,
      top: container.top + (container.height - renderedH) / 2,
      width: renderedW,
      height: renderedH,
    };
  }

  function onVideoLoadedMetadata() {
    if (videoEl) {
      videoNativeWidth = videoEl.videoWidth;
      videoNativeHeight = videoEl.videoHeight;
    }
  }

  function onWindowBlur() {
    kvm.releaseAllKeys();
    if (kvm.mouseCaptured) kvm.releasePointerLock();
  }

  function onPointerLockChange() {
    if (!document.pointerLockElement) kvm.mouseCaptured = false;
  }

  async function toggleFullscreen() {
    if (!videoContainerEl) return;
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await videoContainerEl.requestFullscreen();
    }
  }

  function isTypingInUI(e: KeyboardEvent): boolean {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if ((e.target as HTMLElement)?.isContentEditable) return true;
    return false;
  }

  function onKeyDown(e: KeyboardEvent) {
    if (isTypingInUI(e)) return;
    kvm.handleKeyDown(e);
  }
  function onKeyUp(e: KeyboardEvent) {
    if (isTypingInUI(e)) return;
    kvm.handleKeyUp(e);
  }

  function isInsideContentRect(e: MouseEvent): boolean {
    const rect = getContentRect();
    return (
      e.clientX >= rect.left &&
      e.clientX <= rect.left + rect.width &&
      e.clientY >= rect.top &&
      e.clientY <= rect.top + rect.height
    );
  }

  function onMouseMove(e: MouseEvent) {
    if (!isInsideContentRect(e)) return;
    kvm.handleMouseMove(e, getContentRect());
  }
  function onMouseDown(e: MouseEvent) {
    if (!isInsideContentRect(e)) return;
    e.preventDefault();
    kvm.handleMouseDown(e, getContentRect());
  }
  // Listen on window so we never miss a release (e.g. mouse drifts off container)
  function onWindowMouseUp(e: MouseEvent) {
    kvm.handleMouseUp(e, getContentRect());
  }
  function onWheel(e: WheelEvent) {
    if (!isInsideContentRect(e)) return;
    kvm.handleWheel(e, getContentRect());
  }
  function onDblClick() {
    if (!kvm.useAbsoluteMouse && videoContainerEl) {
      kvm.requestPointerLock(videoContainerEl);
    }
  }

  function addSnippet() {
    if (newSnippetName.trim() && newSnippetText.trim()) {
      kvm.addSnippet(newSnippetName.trim(), newSnippetText.trim());
      newSnippetName = '';
      newSnippetText = '';
      showSnippetForm = false;
    }
  }
</script>

<svelte:window
  onkeydown={onKeyDown}
  onkeyup={onKeyUp}
  onblur={onWindowBlur}
  onmouseup={onWindowMouseUp}
/>
<svelte:head>
  <title>Openterface KVM</title>
</svelte:head>

<div class="flex h-screen flex-col bg-background">
  <!-- Toolbar -->
  <header class="flex items-center gap-1.5 border-b border-border px-3 py-1.5">
    <!-- Connection badge / popover -->
    <Popover.Root>
      <Popover.Trigger>
        {#snippet child({ props })}
          <Button variant="outline" size="sm" class="h-7 gap-1.5 px-2 text-xs" {...props}>
            <span
              class="inline-block h-2 w-2 rounded-full {connectionCount === 2
                ? 'bg-green-500'
                : connectionCount === 1
                  ? 'bg-yellow-500'
                  : 'bg-red-500'}"
            ></span>
            KVM
          </Button>
        {/snippet}
      </Popover.Trigger>
      <Popover.Content class="w-80" align="start">
        <div class="space-y-4">
          <!-- Error banner -->
          {#if kvm.lastError}
            <div
              class="flex items-start gap-2 rounded-md bg-destructive/15 p-2 text-xs text-destructive"
            >
              <TriangleAlert class="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span class="flex-1">{kvm.lastError}</span>
              <button class="shrink-0" onclick={() => (kvm.lastError = '')}
                ><X class="h-3 w-3" /></button
              >
            </div>
          {/if}

          <!-- Video source -->
          <div class="space-y-2">
            <div class="flex items-center gap-2 text-xs font-medium">
              <Video class="h-3.5 w-3.5" /> Video Source
              {#if kvm.videoStream}
                <Badge
                  variant="outline"
                  class="ml-auto border-green-600 px-1.5 py-0 text-[10px] text-green-400"
                  >Active</Badge
                >
              {/if}
            </div>
            {#if kvm.videoDevices.length > 0}
              <select
                class="w-full rounded-md border bg-background px-2 py-1.5 text-xs"
                value={kvm.selectedVideoDeviceId}
                onchange={(e) => {
                  const val = (e.target as HTMLSelectElement).value;
                  if (val) kvm.startVideo(val);
                }}
              >
                <option value="">Select a device...</option>
                {#each kvm.videoDevices as device}
                  <option value={device.deviceId}
                    >{device.label || `Camera ${device.deviceId.slice(0, 8)}`}</option
                  >
                {/each}
              </select>
            {:else}
              <p class="text-xs text-muted-foreground">No video devices found</p>
            {/if}
            <div class="flex gap-1">
              <Button
                variant="outline"
                size="sm"
                class="flex-1 text-xs"
                onclick={() => kvm.refreshVideoDevices()}
              >
                <RefreshCw class="mr-1 h-3 w-3" /> Refresh
              </Button>
              {#if kvm.videoStream}
                <Button variant="ghost" size="sm" class="text-xs" onclick={() => kvm.stopVideo()}>
                  <VideoOff class="mr-1 h-3 w-3" /> Stop
                </Button>
              {/if}
            </div>

            <!-- Auto-crop switch -->
            <div class="flex items-center justify-between pt-1">
              <label for="autocrop-switch" class="text-xs text-muted-foreground"
                >Auto-crop black borders</label
              >
              <Switch
                id="autocrop-switch"
                checked={kvm.autoCropEnabled}
                onCheckedChange={(v) => kvm.setAutoCrop(v)}
              />
            </div>
          </div>

          <Separator />

          <!-- Serial -->
          <div class="space-y-2">
            <div class="flex items-center gap-2 text-xs font-medium">
              <Plug class="h-3.5 w-3.5" /> Serial Port
              {#if kvm.connected}
                <Badge
                  variant="outline"
                  class="ml-auto border-green-600 px-1.5 py-0 text-[10px] text-green-400"
                  >Active</Badge
                >
              {/if}
            </div>
            {#if kvm.connected}
              <Button
                variant="destructive"
                size="sm"
                class="w-full text-xs"
                onclick={() => kvm.disconnectSerial()}
              >
                <Unplug class="mr-1 h-3 w-3" /> Disconnect
              </Button>
            {:else}
              <Button size="sm" class="w-full text-xs" onclick={() => kvm.connectSerial()}>
                <Plug class="mr-1 h-3 w-3" /> Connect Serial
              </Button>
            {/if}
            {#if kvm.deviceInfo}
              <div class="space-y-1 rounded-md bg-muted p-2 text-xs">
                <div>Device: <span class="font-medium">{kvm.deviceInfo.versionName}</span></div>
                <div>
                  USB: <span class="font-medium"
                    >{kvm.deviceInfo.usbConnected ? 'Connected' : 'Disconnected'}</span
                  >
                </div>
                <div>
                  LEDs: <span class="font-medium"
                    >{kvm.deviceInfo.ledStatus & 0x01 ? 'NUM ' : ''}{kvm.deviceInfo.ledStatus & 0x02
                      ? 'CAPS '
                      : ''}{kvm.deviceInfo.ledStatus & 0x04 ? 'SCROLL' : ''}{kvm.deviceInfo
                      .ledStatus === 0
                      ? 'None'
                      : ''}</span
                  >
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                class="w-full text-xs"
                onclick={() => kvm.serial.write(buildGetInfoFrame())}
              >
                <RefreshCw class="mr-1 h-3 w-3" /> Refresh Info
              </Button>
            {/if}
          </div>
        </div>
      </Popover.Content>
    </Popover.Root>

    <Separator orientation="vertical" class="mx-1 h-5" />

    <!-- Mouse mode toggle -->
    <div class="flex">
      <Button
        variant={kvm.useAbsoluteMouse ? 'default' : 'outline'}
        size="sm"
        class="h-8 gap-1 rounded-r-none text-xs"
        onclick={() => {
          kvm.useAbsoluteMouse = true;
          if (kvm.mouseCaptured) kvm.releasePointerLock();
        }}
        disabled={!kvm.connected}
      >
        <ArrowsUpFromLine class="h-3.5 w-3.5" />
        <span class="hidden sm:inline">Abs</span>
      </Button>
      <Button
        variant={!kvm.useAbsoluteMouse ? 'default' : 'outline'}
        size="sm"
        class="h-8 gap-1 rounded-l-none border-l-0 text-xs"
        onclick={() => (kvm.useAbsoluteMouse = false)}
        disabled={!kvm.connected}
      >
        <Mouse class="h-3.5 w-3.5" />
        <span class="hidden sm:inline">Rel</span>
      </Button>
    </div>

    <!-- Paste popover -->
    <Popover.Root>
      <Popover.Trigger>
        {#snippet child({ props })}
          <Button
            variant="outline"
            size="sm"
            class="h-7 gap-1 px-2 text-xs"
            {...props}
            disabled={!kvm.connected}
          >
            <ClipboardPaste class="h-3.5 w-3.5" />
            <span class="hidden sm:inline">Paste</span>
          </Button>
        {/snippet}
      </Popover.Trigger>
      <Popover.Content class="w-72" align="start">
        <div class="space-y-3">
          <Button
            size="sm"
            class="w-full text-xs"
            onclick={() => kvm.pasteFromClipboard()}
            disabled={!kvm.connected || kvm.isPasting}
          >
            <ClipboardPaste class="mr-1 h-3 w-3" />
            {kvm.isPasting ? 'Pasting...' : 'Paste from Clipboard'}
          </Button>

          <Separator />

          <div class="flex items-center justify-between">
            <span class="text-xs font-medium">Saved Snippets</span>
            <Button
              variant="ghost"
              size="icon"
              class="h-5 w-5"
              onclick={() => (showSnippetForm = !showSnippetForm)}
            >
              {#if showSnippetForm}<X class="h-3 w-3" />{:else}<Plus class="h-3 w-3" />{/if}
            </Button>
          </div>

          {#if showSnippetForm}
            <div class="space-y-1.5">
              <input
                type="text"
                placeholder="Snippet name"
                class="w-full rounded-md border bg-background px-2 py-1 text-xs"
                bind:value={newSnippetName}
              />
              <textarea
                placeholder="Text to paste..."
                class="w-full rounded-md border bg-background px-2 py-1 text-xs"
                rows="3"
                bind:value={newSnippetText}
              ></textarea>
              <Button
                size="sm"
                class="w-full text-xs"
                onclick={addSnippet}
                disabled={!newSnippetName.trim() || !newSnippetText.trim()}>Save Snippet</Button
              >
            </div>
          {/if}

          {#if kvm.snippets.length > 0}
            <div class="max-h-48 space-y-1 overflow-y-auto">
              {#each kvm.snippets as snippet (snippet.id)}
                <div class="flex items-center gap-1 rounded-md border px-2 py-1">
                  <span class="flex-1 truncate text-xs" title={snippet.text}>{snippet.name}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    class="h-5 w-5 shrink-0"
                    onclick={() => kvm.pasteText(snippet.text)}
                    disabled={!kvm.connected || kvm.isPasting}
                  >
                    <Play class="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    class="h-5 w-5 shrink-0 text-destructive"
                    onclick={() => kvm.removeSnippet(snippet.id)}
                  >
                    <Trash2 class="h-3 w-3" />
                  </Button>
                </div>
              {/each}
            </div>
          {:else if !showSnippetForm}
            <p class="text-xs text-muted-foreground">No saved snippets yet.</p>
          {/if}
        </div>
      </Popover.Content>
    </Popover.Root>

    <!-- Keyboard special keys popup -->
    <Popover.Root>
      <Popover.Trigger>
        {#snippet child({ props })}
          <Button
            variant="outline"
            size="sm"
            class="h-7 gap-1 px-2 text-xs"
            {...props}
            disabled={!kvm.connected}
          >
            <Keyboard class="h-3.5 w-3.5" />
            <span class="hidden sm:inline">Keys</span>
          </Button>
        {/snippet}
      </Popover.Trigger>
      <Popover.Content class="w-auto" align="start">
        <div class="flex flex-wrap gap-1">
          <Button
            variant="outline"
            size="sm"
            class="h-8 min-w-[2.5rem] px-2 text-xs font-mono"
            onclick={() => kvm.sendKeyTap(HID_KEY.Escape)}
            disabled={!kvm.connected}
          >Esc</Button>
          {#each Array.from({ length: 12 }, (_, i) => i + 1) as n}
            <Button
              variant="outline"
              size="sm"
              class="h-8 min-w-[2.5rem] px-2 text-xs font-mono"
              onclick={() => kvm.sendKeyTap(HID_KEY[`F${n}`])}
              disabled={!kvm.connected}
            >F{n}</Button>
          {/each}
          <Button
            variant="outline"
            size="sm"
            class="h-8 min-w-[2.5rem] px-2 text-xs font-mono"
            onclick={() => kvm.sendKeyTap(HID_KEY.Delete)}
            disabled={!kvm.connected}
          >Del</Button>
        </div>
      </Popover.Content>
    </Popover.Root>

    <!-- Fullscreen -->
    <Tooltip.Root>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          <Button
            variant="outline"
            size="sm"
            class="h-8 text-xs"
            {...props}
            onclick={() => toggleFullscreen()}
            disabled={!kvm.videoStream}
          >
            <Maximize class="h-3.5 w-3.5" />
          </Button>
        {/snippet}
      </Tooltip.Trigger>
      <Tooltip.Content>Fullscreen</Tooltip.Content>
    </Tooltip.Root>

    <div class="flex-1"></div>

    <!-- Info popover -->
    <Popover.Root>
      <Popover.Trigger>
        {#snippet child({ props })}
          <Button variant="ghost" size="icon" class="h-7 w-7" {...props}>
            <Info class="h-3.5 w-3.5" />
          </Button>
        {/snippet}
      </Popover.Trigger>
      <Popover.Content class="w-72" align="end">
        <div class="space-y-2">
          <div class="flex items-center gap-2">
            <Monitor class="h-4 w-4 text-primary" />
            <span class="text-sm font-semibold">Openterface KVM</span>
          </div>
          <p class="text-xs leading-relaxed text-muted-foreground">
            A browser-based KVM (Keyboard, Video, Mouse) client for
            <strong>Openterface</strong> devices. Control a target computer's keyboard and mouse over
            USB while viewing its display as a video feed &mdash; all from this tab.
          </p>
        </div>
      </Popover.Content>
    </Popover.Root>
  </header>

  <!-- Video area — takes all remaining space -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    bind:this={videoContainerEl}
    class="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-black"
    onmousemove={onMouseMove}
    onmousedown={onMouseDown}
    onwheel={onWheel}
    oncontextmenu={(e) => e.preventDefault()}
    ondblclick={onDblClick}
  >
    {#if kvm.videoStream}
      <!-- svelte-ignore a11y_media_has_caption -->
      <video
        bind:this={videoEl}
        autoplay
        playsinline
        class={kvm.connected ? 'cursor-none' : ''}
        style={videoStyle || 'width:100%;height:100%;object-fit:contain'}
        onloadedmetadata={onVideoLoadedMetadata}
      ></video>
    {:else}
      <div class="flex flex-col items-center gap-4 text-muted-foreground">
        <VideoOff class="h-12 w-12" />
        <p class="text-sm">No video source</p>
      </div>
    {/if}

    <!-- Overlay indicators -->
    {#if kvm.mouseCaptured}
      <div class="pointer-events-none absolute top-2 left-2">
        <Badge class="bg-green-600 text-[10px] text-white">Mouse Captured (Esc)</Badge>
      </div>
    {/if}
    {#if kvm.isPasting}
      <div class="pointer-events-none absolute top-2 right-2">
        <Badge class="bg-blue-600 text-[10px] text-white">Pasting...</Badge>
      </div>
    {/if}
  </div>
</div>
