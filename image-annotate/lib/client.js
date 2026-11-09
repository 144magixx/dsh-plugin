/**
 * dsh-image-annotate Client. Hand-written classic-script ModuleLoader bundle.
 *
 * The native composer attachment rail (`conversation.input.attachments`, owned
 * by ui-attachment) is wrapped, not rebuilt. A double-click on a draft image
 * thumbnail opens a full-window annotation editor; a single click still opens
 * the native original-image preview after the double-click window passes.
 *
 * Saving exports the annotated image at its original resolution and replaces
 * the draft attachment in place: the edited image and every later rail item
 * are removed and re-added in order through the slot's own callbacks, and the
 * originals are restored automatically if the composer refuses the new file.
 */
window.__ModuleLoader__.load({
  id: 'dsh-image-annotate',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const { useState, useRef, useEffect, useLayoutEffect, useCallback } = React
    let ReactDOM = null
    try { ReactDOM = require('react-dom') } catch { ReactDOM = null }

    const TYPE = 'dsh-image-annotate'
    const NS = 'image-annotate'
    const SLOT = 'conversation.input.attachments'
    const OWN_ID = `${TYPE}.composer-attachments`
    const DOUBLE_CLICK_MS = 300
    const REMOVE_CONFIRM_MS = 1500
    const ADD_CONFIRM_MS = 2500
    const HISTORY_LIMIT = 100
    const LINE_HEIGHT = 1.25
    const ENCODABLE = ['image/png', 'image/jpeg', 'image/webp']
    const EXTENSIONS = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }
    const FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Segoe UI", sans-serif'
    const COLORS = ['#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#0a84ff', '#af52de', '#1c1c1e', '#ffffff']
    const SIZE_KEYS = ['s', 'm', 'l']
    // Multiples of the image unit (longest edge / 1000), so marks look alike on any resolution.
    const SIZES = {
      s: { stroke: 3, highlighter: 12, text: 22, marker: 13, mosaic: 120 },
      m: { stroke: 6, highlighter: 20, text: 32, marker: 18, mosaic: 70 },
      l: { stroke: 10, highlighter: 32, text: 48, marker: 26, mosaic: 40 },
    }
    const TOOLS = [
      { id: 'select', key: 'v' }, { id: 'pen', key: 'p' }, { id: 'highlighter', key: 'h' },
      { id: 'rect', key: 'r' }, { id: 'ellipse', key: 'o' }, { id: 'arrow', key: 'a' },
      { id: 'marker', key: 'n' }, { id: 'text', key: 't' }, { id: 'mosaic', key: 'm' },
    ]

    const ZH = {
      thumbTitle: '单击查看原图，双击编辑标注',
      title: '编辑图片', subtitle: '保存后替换输入框中的原图',
      'tool.select': '选择 / 移动', 'tool.pen': '画笔', 'tool.highlighter': '荧光笔', 'tool.rect': '矩形', 'tool.ellipse': '圆圈',
      'tool.arrow': '箭头', 'tool.marker': '序号圆点', 'tool.text': '文字', 'tool.mosaic': '马赛克',
      color: '颜色 {color}', 'size.s': '细', 'size.m': '中', 'size.l': '粗',
      undo: '撤销', redo: '重做', remove: '删除选中', clear: '清空标注', cancel: '取消', save: '保存', saving: '正在保存…',
      loading: '正在载入图片…', loadFailed: '图片无法载入，不能编辑',
      textPlaceholder: '输入文字', hint: '拖动绘制 · Shift 约束比例 · 双击文字可修改 · Delete 删除选中',
      confirmTitle: '放弃未保存的标注？', keepEditing: '继续编辑', discard: '放弃',
      'error.locked': '输入框当前不接受图片（可能正在发送），请稍后再保存',
      'error.gone': '原图已不在输入框中，无法替换',
      'error.busy': '正在替换上一张图片，请稍候',
      'error.rejected': '输入框没有接受编辑后的图片（可能超出大小或数量限制），已恢复原图',
      'error.restoreFailed': '替换失败，原图也未能恢复，请重新添加图片',
      'error.encode': '图片导出失败',
    }
    const EN = {
      thumbTitle: 'Click to view the original, double-click to annotate',
      title: 'Edit image', subtitle: 'Saving replaces the original in the composer',
      'tool.select': 'Select / move', 'tool.pen': 'Pen', 'tool.highlighter': 'Highlighter', 'tool.rect': 'Rectangle', 'tool.ellipse': 'Circle',
      'tool.arrow': 'Arrow', 'tool.marker': 'Numbered marker', 'tool.text': 'Text', 'tool.mosaic': 'Mosaic',
      color: 'Color {color}', 'size.s': 'Thin', 'size.m': 'Medium', 'size.l': 'Thick',
      undo: 'Undo', redo: 'Redo', remove: 'Delete selection', clear: 'Clear annotations', cancel: 'Cancel', save: 'Save', saving: 'Saving…',
      loading: 'Loading image…', loadFailed: 'This image could not be loaded for editing',
      textPlaceholder: 'Type text', hint: 'Drag to draw · Shift keeps proportions · Double-click text to edit · Delete removes the selection',
      confirmTitle: 'Discard unsaved annotations?', keepEditing: 'Keep editing', discard: 'Discard',
      'error.locked': 'The composer is not accepting images right now (a send may be in progress). Try saving again shortly.',
      'error.gone': 'The original image is no longer in the composer.',
      'error.busy': 'Still replacing the previous image.',
      'error.rejected': 'The composer refused the edited image (size or count limit). The original was restored.',
      'error.restoreFailed': 'Replacing failed and the original could not be restored. Please add the image again.',
      'error.encode': 'The image could not be exported.',
    }

    // ---- Pure helpers (exported for tests) ---------------------------------------

    function replaceError(code) {
      const error = new Error(code)
      error.code = code
      return error
    }

    /** Canvas can encode PNG, JPEG and WebP; everything else (GIF, …) becomes PNG. */
    function outputType(type) { return ENCODABLE.includes(type) ? type : 'image/png' }

    function outputName(name, fromType, toType) {
      if (name && fromType === toType) return name
      const stem = String(name || '').replace(/\.[^./\\]*$/, '') || 'image'
      return `${stem}.${EXTENSIONS[toType] || 'png'}`
    }

    /**
     * The composer appends new attachments, so an in-place replacement removes
     * the target and every later rail item, then re-adds them after the edit.
     */
    function planReplace(attachments, id) {
      const list = Array.isArray(attachments) ? attachments : []
      const index = list.findIndex((attachment) => attachment.id === id)
      if (index < 0 || list[index].kind !== 'image') return null
      const removed = list.slice(index)
      if (removed.some((attachment) => !attachment.file)) return null
      return { index, removed }
    }

    /** Current id of the edited draft: by File identity first, then by the id it had when opened. */
    function targetId(attachments, target) {
      const list = Array.isArray(attachments) ? attachments : []
      return list.find((attachment) => target.file && attachment.file === target.file)?.id ?? target.id
    }

    function unitFor(width, height) { return Math.max(0.5, Math.max(width, height) / 1000) }

    function sizeValue(type, sizeKey, unit) {
      const size = SIZES[sizeKey] || SIZES.m
      if (type === 'highlighter') return size.highlighter * unit
      if (type === 'text') return size.text * unit
      if (type === 'marker') return size.marker * unit
      if (type === 'mosaic') return Math.max(4, Math.round(1000 * unit / size.mosaic))
      return size.stroke * unit
    }

    /** Re-style a shape with a new color and/or size key. */
    function restyle(shape, changes, unit) {
      const next = { ...shape }
      if (changes.color && shape.type !== 'mosaic') next.color = changes.color
      if (changes.sizeKey) {
        next.sizeKey = changes.sizeKey
        const value = sizeValue(shape.type, changes.sizeKey, unit)
        if (shape.type === 'text') next.size = value
        else if (shape.type === 'marker') next.r = value
        else if (shape.type === 'mosaic') next.block = value
        else next.width = value
      }
      return next
    }

    function nextMarkerNumber(shapes) {
      return shapes.reduce((max, shape) => shape.type === 'marker' ? Math.max(max, shape.n) : max, 0) + 1
    }

    /** Shift constrains boxes to squares and arrows to 45° steps. */
    function constrain(type, x1, y1, x2, y2, shift) {
      if (!shift) return { x2, y2 }
      const dx = x2 - x1, dy = y2 - y1
      if (type === 'arrow') {
        const length = Math.hypot(dx, dy)
        const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4)
        return { x2: x1 + Math.cos(angle) * length, y2: y1 + Math.sin(angle) * length }
      }
      const side = Math.max(Math.abs(dx), Math.abs(dy))
      return { x2: x1 + Math.sign(dx || 1) * side, y2: y1 + Math.sign(dy || 1) * side }
    }

    function distToSegment(px, py, ax, ay, bx, by) {
      const dx = bx - ax, dy = by - ay
      const length = dx * dx + dy * dy
      const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length))
      return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
    }

    function textLayout(shape, measure) {
      const lines = String(shape.text ?? '').split('\n')
      const lineHeight = shape.size * LINE_HEIGHT
      let width = 0
      for (const line of lines) width = Math.max(width, measure(line, shape.size))
      return { lines, lineHeight, width, height: lines.length * lineHeight }
    }

    function shapeBounds(shape, measure) {
      if (shape.type === 'pen' || shape.type === 'highlighter') {
        let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity
        for (const [x, y] of shape.points) { x1 = Math.min(x1, x); y1 = Math.min(y1, y); x2 = Math.max(x2, x); y2 = Math.max(y2, y) }
        const pad = shape.width / 2
        return { x: x1 - pad, y: y1 - pad, w: x2 - x1 + 2 * pad, h: y2 - y1 + 2 * pad }
      }
      if (shape.type === 'marker') return { x: shape.x - shape.r, y: shape.y - shape.r, w: 2 * shape.r, h: 2 * shape.r }
      if (shape.type === 'text') {
        const layout = textLayout(shape, measure)
        return { x: shape.x, y: shape.y, w: layout.width, h: layout.height }
      }
      const pad = shape.type === 'mosaic' ? 0 : shape.width / 2
      const x = Math.min(shape.x1, shape.x2), y = Math.min(shape.y1, shape.y2)
      return { x: x - pad, y: y - pad, w: Math.abs(shape.x2 - shape.x1) + 2 * pad, h: Math.abs(shape.y2 - shape.y1) + 2 * pad }
    }

    /** Whether image point (x, y) touches the shape; tol is in image pixels. */
    function hitTest(shape, x, y, tol, measure) {
      switch (shape.type) {
        case 'pen': case 'highlighter': {
          const reach = shape.width / 2 + tol
          const points = shape.points
          if (points.length === 1) return Math.hypot(x - points[0][0], y - points[0][1]) <= reach
          for (let i = 1; i < points.length; i++) {
            if (distToSegment(x, y, points[i - 1][0], points[i - 1][1], points[i][0], points[i][1]) <= reach) return true
          }
          return false
        }
        case 'arrow': return distToSegment(x, y, shape.x1, shape.y1, shape.x2, shape.y2) <= shape.width / 2 + tol
        case 'rect': {
          const left = Math.min(shape.x1, shape.x2), right = Math.max(shape.x1, shape.x2)
          const top = Math.min(shape.y1, shape.y2), bottom = Math.max(shape.y1, shape.y2)
          const reach = shape.width / 2 + tol
          const inside = x >= left - reach && x <= right + reach && y >= top - reach && y <= bottom + reach
          const deep = x > left + reach && x < right - reach && y > top + reach && y < bottom - reach
          return inside && !deep
        }
        case 'ellipse': {
          const cx = (shape.x1 + shape.x2) / 2, cy = (shape.y1 + shape.y2) / 2
          const rx = Math.abs(shape.x2 - shape.x1) / 2, ry = Math.abs(shape.y2 - shape.y1) / 2
          if (rx < 1e-6 || ry < 1e-6) return distToSegment(x, y, shape.x1, shape.y1, shape.x2, shape.y2) <= shape.width / 2 + tol
          const radial = Math.hypot((x - cx) / rx, (y - cy) / ry)
          return Math.abs(radial - 1) * Math.min(rx, ry) <= shape.width / 2 + tol
        }
        case 'marker': return Math.hypot(x - shape.x, y - shape.y) <= shape.r + tol
        case 'text': case 'mosaic': {
          const box = shapeBounds(shape, measure)
          return x >= box.x - tol && x <= box.x + box.w + tol && y >= box.y - tol && y <= box.y + box.h + tol
        }
        default: return false
      }
    }

    /** Topmost shape under the point, or null. */
    function pick(shapes, x, y, tol, measure) {
      for (let i = shapes.length - 1; i >= 0; i--) if (hitTest(shapes[i], x, y, tol, measure)) return shapes[i]
      return null
    }

    function translate(shape, dx, dy) {
      if (shape.type === 'pen' || shape.type === 'highlighter') return { ...shape, points: shape.points.map(([x, y]) => [x + dx, y + dy]) }
      if (shape.type === 'marker' || shape.type === 'text') return { ...shape, x: shape.x + dx, y: shape.y + dy }
      return { ...shape, x1: shape.x1 + dx, y1: shape.y1 + dy, x2: shape.x2 + dx, y2: shape.y2 + dy }
    }

    /** Boxes and arrows shorter than the threshold are accidental clicks. */
    function isMeaningful(shape, threshold) {
      if (shape.type === 'arrow') return Math.hypot(shape.x2 - shape.x1, shape.y2 - shape.y1) >= threshold
      if (shape.type === 'rect' || shape.type === 'ellipse' || shape.type === 'mosaic') return Math.abs(shape.x2 - shape.x1) >= threshold && Math.abs(shape.y2 - shape.y1) >= threshold
      if (shape.type === 'text') return String(shape.text ?? '').trim() !== ''
      return true
    }

    function luminance(hex) {
      const value = /^#([0-9a-f]{6})$/i.exec(hex)
      if (!value) return 0
      const n = parseInt(value[1], 16)
      return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255
    }

    function history(shapes = []) { return { shapes, past: [], future: [] } }
    function pushHistory(doc, shapes) {
      if (shapes === doc.shapes) return doc
      return { shapes, past: [...doc.past, doc.shapes].slice(-HISTORY_LIMIT), future: [] }
    }
    function undoHistory(doc) {
      if (doc.past.length === 0) return doc
      return { shapes: doc.past[doc.past.length - 1], past: doc.past.slice(0, -1), future: [doc.shapes, ...doc.future] }
    }
    function redoHistory(doc) {
      if (doc.future.length === 0) return doc
      return { shapes: doc.future[0], past: [...doc.past, doc.shapes], future: doc.future.slice(1) }
    }

    // ---- Drawing ----------------------------------------------------------------

    function fontFor(size) { return `600 ${size}px ${FONT_FAMILY}` }

    let measureContext = null
    function measureText(text, size) {
      if (!measureContext) measureContext = document.createElement('canvas').getContext('2d')
      measureContext.font = fontFor(size)
      return measureContext.measureText(text).width
    }

    const mosaicCache = new WeakMap()
    function drawMosaic(c, shape, source) {
      const x = Math.round(Math.min(shape.x1, shape.x2)), y = Math.round(Math.min(shape.y1, shape.y2))
      const w = Math.round(Math.abs(shape.x2 - shape.x1)), hgt = Math.round(Math.abs(shape.y2 - shape.y1))
      if (w < 1 || hgt < 1 || !source) return
      const block = Math.max(2, shape.block)
      const tw = Math.max(1, Math.ceil(w / block)), th = Math.max(1, Math.ceil(hgt / block))
      let cached = mosaicCache.get(shape)
      if (!cached || cached.source !== source) {
        const small = document.createElement('canvas')
        small.width = tw; small.height = th
        const sc = small.getContext('2d')
        sc.imageSmoothingEnabled = true
        sc.imageSmoothingQuality = 'high'
        sc.drawImage(source, x, y, tw * block, th * block, 0, 0, tw, th)
        cached = { source, small }
        mosaicCache.set(shape, cached)
      }
      c.save()
      c.beginPath(); c.rect(x, y, w, hgt); c.clip()
      c.imageSmoothingEnabled = false
      c.drawImage(cached.small, 0, 0, tw, th, x, y, tw * block, th * block)
      c.restore()
    }

    function strokePoints(c, points) {
      c.beginPath()
      if (points.length === 1) {
        c.arc(points[0][0], points[0][1], c.lineWidth / 2, 0, Math.PI * 2)
        c.fillStyle = c.strokeStyle
        c.fill()
        return
      }
      c.moveTo(points[0][0], points[0][1])
      for (let i = 1; i < points.length - 1; i++) {
        const midX = (points[i][0] + points[i + 1][0]) / 2, midY = (points[i][1] + points[i + 1][1]) / 2
        c.quadraticCurveTo(points[i][0], points[i][1], midX, midY)
      }
      const last = points[points.length - 1]
      c.lineTo(last[0], last[1])
      c.stroke()
    }

    function drawShape(c, shape, source) {
      c.save()
      c.strokeStyle = shape.color
      c.fillStyle = shape.color
      c.lineCap = 'round'
      c.lineJoin = 'round'
      switch (shape.type) {
        case 'pen':
          c.lineWidth = shape.width
          strokePoints(c, shape.points)
          break
        case 'highlighter':
          c.globalAlpha = 0.38
          c.lineWidth = shape.width
          strokePoints(c, shape.points)
          break
        case 'rect':
          c.lineWidth = shape.width
          c.strokeRect(Math.min(shape.x1, shape.x2), Math.min(shape.y1, shape.y2), Math.abs(shape.x2 - shape.x1), Math.abs(shape.y2 - shape.y1))
          break
        case 'ellipse':
          c.lineWidth = shape.width
          c.beginPath()
          c.ellipse((shape.x1 + shape.x2) / 2, (shape.y1 + shape.y2) / 2, Math.abs(shape.x2 - shape.x1) / 2, Math.abs(shape.y2 - shape.y1) / 2, 0, 0, Math.PI * 2)
          c.stroke()
          break
        case 'arrow': {
          const dx = shape.x2 - shape.x1, dy = shape.y2 - shape.y1
          const length = Math.hypot(dx, dy)
          if (length < 1e-6) break
          const angle = Math.atan2(dy, dx)
          const head = Math.min(length * 0.6, Math.max(shape.width * 3.4, 10))
          c.lineWidth = shape.width
          c.beginPath()
          c.moveTo(shape.x1, shape.y1)
          c.lineTo(shape.x2 - Math.cos(angle) * head * 0.6, shape.y2 - Math.sin(angle) * head * 0.6)
          c.stroke()
          c.beginPath()
          c.moveTo(shape.x2, shape.y2)
          c.lineTo(shape.x2 - head * Math.cos(angle - 0.42), shape.y2 - head * Math.sin(angle - 0.42))
          c.lineTo(shape.x2 - head * Math.cos(angle + 0.42), shape.y2 - head * Math.sin(angle + 0.42))
          c.closePath()
          c.fill()
          break
        }
        case 'marker': {
          const light = luminance(shape.color) > 0.72
          c.beginPath()
          c.arc(shape.x, shape.y, shape.r, 0, Math.PI * 2)
          c.fill()
          c.lineWidth = Math.max(1, shape.r * 0.14)
          c.strokeStyle = light ? 'rgba(0,0,0,0.55)' : '#ffffff'
          c.stroke()
          c.fillStyle = light ? '#1c1c1e' : '#ffffff'
          const label = String(shape.n)
          c.font = `700 ${shape.r * (label.length > 1 ? 0.95 : 1.15)}px ${FONT_FAMILY}`
          c.textAlign = 'center'
          c.textBaseline = 'middle'
          c.fillText(label, shape.x, shape.y + shape.r * 0.04)
          break
        }
        case 'text': {
          const layout = textLayout(shape, measureText)
          c.font = fontFor(shape.size)
          c.textBaseline = 'middle'
          c.lineWidth = Math.max(1, shape.size * 0.14)
          c.strokeStyle = luminance(shape.color) > 0.6 ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.9)'
          layout.lines.forEach((line, index) => {
            const y = shape.y + index * layout.lineHeight + layout.lineHeight / 2
            c.strokeText(line, shape.x, y)
            c.fillText(line, shape.x, y)
          })
          break
        }
        case 'mosaic':
          drawMosaic(c, shape, source)
          break
      }
      c.restore()
    }

    function drawSelection(c, box, pixel) {
      const pad = 4 * pixel
      c.save()
      c.lineWidth = 1.5 * pixel
      c.strokeStyle = 'rgba(255,255,255,0.9)'
      c.strokeRect(box.x - pad, box.y - pad, box.w + 2 * pad, box.h + 2 * pad)
      c.setLineDash([5 * pixel, 4 * pixel])
      c.strokeStyle = '#0a84ff'
      c.strokeRect(box.x - pad, box.y - pad, box.w + 2 * pad, box.h + 2 * pad)
      c.restore()
    }

    /** Render image + annotations at full resolution and encode like the original. */
    async function exportAnnotated(image, shapes, original) {
      const width = image.naturalWidth, height = image.naturalHeight
      const type = outputType(original.type)
      const quality = type === 'image/png' ? undefined : 0.92
      // HTMLCanvasElement.toBlob encodes in idle periods, so a busy page (a streaming
      // reply) can stall it for seconds; OffscreenCanvas encodes right away.
      const offscreen = typeof OffscreenCanvas === 'function'
      const canvas = offscreen ? new OffscreenCanvas(width, height) : document.createElement('canvas')
      if (!offscreen) { canvas.width = width; canvas.height = height }
      const c = canvas.getContext('2d')
      if (type === 'image/jpeg') { c.fillStyle = '#ffffff'; c.fillRect(0, 0, width, height) }
      c.drawImage(image, 0, 0, width, height)
      for (const shape of shapes) drawShape(c, shape, image)
      let blob
      try {
        blob = offscreen
          ? await canvas.convertToBlob({ type, quality })
          : await new Promise((resolve) => canvas.toBlob(resolve, type, quality))
      } catch { blob = null }
      if (!blob) throw replaceError('encode')
      const actual = blob.type || type
      return new File([blob], outputName(original.name, original.type, actual), { type: actual, lastModified: Date.now() })
    }

    // ---- Icons --------------------------------------------------------------------
    const ICONS = {
      select: '<path d="M6 3.8 18.4 11l-5.6 1.5-2.6 5.4z"/>',
      pen: '<path d="M4.5 19.5 5.6 15 16 4.6a2 2 0 0 1 2.9 2.9L8.5 17.9z"/><path d="m14.4 6.2 2.9 2.9"/>',
      highlighter: '<path d="m9 13.5 7.4-9 3.6 3.6-9 7.4z"/><path d="M9 13.5 6.2 16.3l1.5 1.5 2.8-2.8"/><path d="M4 20.5h9"/>',
      rect: '<rect x="4" y="6" width="16" height="12" rx="1.5"/>',
      ellipse: '<ellipse cx="12" cy="12" rx="8.5" ry="6.5"/>',
      arrow: '<path d="M5 19 18.5 5.5"/><path d="M10 5h9v9"/>',
      marker: '<circle cx="12" cy="12" r="8.2"/><path d="M10.6 9.4 12.5 8v8"/>',
      text: '<path d="M5.5 7V5h13v2"/><path d="M12 5v14"/><path d="M9 19h6"/>',
      mosaic: '<rect x="4" y="4" width="16" height="16" rx="1.5"/><path d="M4 9.3h16M4 14.7h16M9.3 4v16M14.7 4v16" stroke-width="1"/><path d="M4.8 4.8h4.5v4.5H4.8zM14.7 4.8h4.5v4.5h-4.5zM9.3 9.3h5.4v5.4H9.3zM4.8 14.7h4.5v4.5H4.8zM14.7 14.7h4.5v4.5h-4.5z" fill="currentColor" stroke="none"/>',
      undo: '<path d="M8.5 7 4.5 11l4 4"/><path d="M4.5 11h10a5 5 0 0 1 0 10H12"/>',
      redo: '<path d="m15.5 7 4 4-4 4"/><path d="M19.5 11h-10a5 5 0 0 0 0 10H12"/>',
      remove: '<path d="M4.5 7h15M10 11v6M14 11v6M6.5 7l1 12.5h9l1-12.5M9.5 7V4.5h5V7"/>',
      clear: '<path d="m4.5 19.5 15-15"/><circle cx="12" cy="12" r="8.5"/>',
    }
    function Icon({ name, size = 18 }) {
      return h('svg', { viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, dangerouslySetInnerHTML: { __html: ICONS[name] } })
    }

    // ---- Styles ---------------------------------------------------------------------
    const PENCIL = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M4.5 19.5 5.6 15 16 4.6a2 2 0 0 1 2.9 2.9L8.5 17.9z'/%3E%3C/svg%3E\")"
    const CSS = `
[data-image-annotate-editable]{position:relative}
[data-image-annotate-editable]::after{content:"";position:absolute;right:4px;bottom:4px;width:18px;height:18px;border-radius:50%;background:rgba(0,0,0,.58) ${PENCIL} center/11px no-repeat;opacity:0;transition:opacity .15s ease;pointer-events:none}
@media (hover:hover){[data-image-annotate-editable]:hover::after{opacity:1}}
.dia-root{position:fixed;inset:0;z-index:10050;display:flex;flex-direction:column;background:rgba(14,14,16,.9);color:#f5f5f7;font:13px/1.4 ${FONT_FAMILY};-webkit-user-select:none;user-select:none;outline:none;animation:dia-in .14s ease-out}
@keyframes dia-in{from{opacity:0}to{opacity:1}}
@media (prefers-reduced-motion:reduce){.dia-root{animation:none}}
.dia-header{flex:none;display:flex;align-items:center;gap:8px;height:56px;padding:0 16px}
.dia-heading{min-width:0;flex:1;display:flex;align-items:baseline;gap:10px}
.dia-title{font-size:15px;font-weight:600;white-space:nowrap}
.dia-sub{color:rgba(245,245,247,.55);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dia-btn{appearance:none;border:0;background:transparent;color:inherit;height:34px;min-width:34px;padding:0 8px;border-radius:9px;display:inline-grid;place-items:center;cursor:pointer;font:inherit}
.dia-btn:hover:not(:disabled){background:rgba(255,255,255,.1)}
.dia-btn:disabled{opacity:.35;cursor:default}
.dia-btn:focus-visible,.dia-swatch:focus-visible{outline:2px solid #0a84ff;outline-offset:1px}
.dia-btn[aria-pressed=true]{background:rgba(255,255,255,.18);color:#fff}
.dia-text-btn{padding:0 14px;font-weight:500}
.dia-primary{background:#0a84ff;color:#fff}
.dia-primary:hover:not(:disabled){background:#2a94ff}
.dia-sep{width:1px;height:20px;background:rgba(255,255,255,.14);margin:0 4px;flex:none}
.dia-stage{position:relative;flex:1;min-height:0;display:grid;place-items:center;overflow:hidden;padding:8px 24px}
.dia-canvas-wrap{position:relative;box-shadow:0 10px 40px rgba(0,0,0,.45);background:repeating-conic-gradient(#3a3a3e 0 25%,#2c2c30 0 50%) 0 0/16px 16px}
.dia-canvas{display:block;touch-action:none;cursor:crosshair}
.dia-canvas[data-tool=text]{cursor:text}
.dia-canvas[data-tool=select]{cursor:default}
.dia-canvas[data-hover=move]{cursor:move}
.dia-textarea{position:absolute;margin:0;padding:0;border:1px dashed rgba(10,132,255,.95);border-radius:2px;background:rgba(0,0,0,.08);outline:none;resize:none;overflow:hidden;white-space:pre;font-weight:600;font-family:${FONT_FAMILY};-webkit-user-select:text;user-select:text;box-sizing:content-box}
.dia-toolbar{flex:none;align-self:center;display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:2px;max-width:calc(100vw - 32px);margin:4px 16px 10px;padding:6px;border-radius:14px;background:rgba(44,44,48,.96);border:1px solid rgba(255,255,255,.08);box-shadow:0 8px 30px rgba(0,0,0,.35)}
.dia-group{display:flex;align-items:center;gap:2px}
.dia-swatch{appearance:none;width:24px;height:24px;margin:0 2px;border-radius:50%;border:2px solid transparent;padding:0;cursor:pointer;display:grid;place-items:center;background:transparent}
.dia-swatch span{width:16px;height:16px;border-radius:50%;box-shadow:inset 0 0 0 1px rgba(255,255,255,.25)}
.dia-swatch[aria-pressed=true]{border-color:#fff}
.dia-dot{display:block;border-radius:50%;background:currentColor}
.dia-hint{flex:none;text-align:center;color:rgba(245,245,247,.45);font-size:12px;margin:0 16px 12px}
.dia-status{position:absolute;left:50%;top:12px;transform:translateX(-50%);max-width:min(560px,calc(100% - 32px));padding:9px 14px;border-radius:10px;background:rgba(58,58,62,.97);box-shadow:0 6px 24px rgba(0,0,0,.4);text-align:center;z-index:2}
.dia-status[data-kind=error]{background:#5a1f1d;color:#ffd7d4}
.dia-confirm{position:absolute;inset:0;display:grid;place-items:center;background:rgba(0,0,0,.4);z-index:3}
.dia-dialog{min-width:280px;padding:18px 18px 14px;border-radius:14px;background:#2c2c30;box-shadow:0 18px 50px rgba(0,0,0,.5)}
.dia-dialog p{margin:0 0 16px;font-size:14px;font-weight:600}
.dia-actions{display:flex;justify-content:flex-end;gap:8px}
.dia-danger{background:#ff453a;color:#fff}
.dia-danger:hover:not(:disabled){background:#ff5a50}
`

    function ensureStyle() {
      if (typeof document === 'undefined' || document.querySelector('style[data-image-annotate-style]')) return () => {}
      const style = document.createElement('style')
      style.setAttribute('data-image-annotate-style', '')
      style.textContent = CSS
      document.head.appendChild(style)
      return () => style.remove()
    }

    // ---- Composer rail wrapper ---------------------------------------------------

    /** Map a click target in the native rail to its editable draft image. */
    function findThumbnail(target, host, attachments, uploads) {
      if (!host || !target || typeof target.closest !== 'function' || !host.contains(target)) return null
      const button = target.closest('button')
      if (!button || !host.contains(button)) return null
      const image = Array.from(button.children).find((child) => child.tagName === 'IMG')
      if (!image) return null
      const source = image.getAttribute('src')
      const attachment = (attachments || []).find((item) => item.kind === 'image' && item.previewUrl === source)
      if (!attachment) return null
      // Failed uploads render retry / refusal controls; leave those native.
      if (uploads?.[attachment.id]?.status === 'error') return null
      return { button, attachment }
    }

    function registerReplacement(ctx, slot, ownId, make) {
      let previous
      let unregister
      let disposed = false
      function reconcile() {
        if (disposed) return
        const original = ctx.slots.entries(slot).find((entry) => entry.options.id !== ownId)
        if (original === previous) return
        previous = original
        unregister?.(); unregister = undefined
        if (!original) return
        try {
          unregister = ctx.slots.register({ ...original.options, name: slot, id: ownId, locale: original.locale, inject: original.inject, priority: (original.options.priority ?? 0) - 1 }, make(original.component))
        } catch (error) {
          console.error('[dsh-image-annotate] Could not wrap the composer attachments; native rail retained.', error)
        }
      }
      const unsubscribe = ctx.slots.subscribe(slot, reconcile)
      reconcile()
      return () => { disposed = true; unsubscribe(); unregister?.() }
    }

    /**
     * Replacement driver. The composer exposes only remove + append, and its
     * intake reads the attachment list from the render it was created in, so
     * each step waits for the next render of the slot props.
     */
    function useReplacement(latest) {
      const pending = useRef(null)
      const [, setTick] = useState(0)

      const finish = useCallback((op, error, value) => {
        clearTimeout(op.timer)
        if (pending.current === op) pending.current = null
        if (error) op.reject(error); else op.resolve(value)
      }, [])

      const restore = useCallback((op, code) => {
        clearTimeout(op.timer)
        const present = latest.current.attachments || []
        const missing = op.removed.filter((item) => !present.some((current) => current.id === item.id))
        if (missing.length === 0) { finish(op, replaceError(code)); return }
        op.phase = 'restoring'
        op.code = code
        op.restoring = missing.map((item) => item.file)
        latest.current.onAddFiles(op.restoring)
        op.timer = setTimeout(() => finish(op, replaceError('restoreFailed')), ADD_CONFIRM_MS)
      }, [finish])

      const advance = useCallback(() => {
        const op = pending.current
        if (!op) return
        const props = latest.current
        const present = props.attachments || []
        const has = (file) => present.some((item) => item.file === file)
        if (op.phase === 'removing') {
          if (op.removed.some((item) => present.some((current) => current.id === item.id))) return
          clearTimeout(op.timer)
          op.phase = 'adding'
          props.onAddFiles(op.files)
          op.timer = setTimeout(() => restore(op, 'rejected'), ADD_CONFIRM_MS)
        } else if (op.phase === 'adding') {
          if (op.files.every(has)) finish(op, null, present.find((item) => item.file === op.files[0]))
        } else if (op.phase === 'restoring') {
          if (op.restoring.every(has)) finish(op, replaceError(op.code))
        }
      }, [finish, restore])

      useEffect(() => { advance() })
      useEffect(() => () => { const op = pending.current; if (op) { clearTimeout(op.timer); pending.current = null } }, [])

      return useCallback((target, file) => new Promise((resolve, reject) => {
        const props = latest.current
        if (pending.current) { reject(replaceError('busy')); return }
        if (props.canAcceptDrop !== true || typeof props.onAddFiles !== 'function' || typeof props.onRemoveAttachment !== 'function') { reject(replaceError('locked')); return }
        // A restore after a refusal re-adds the same File under a new id; follow the File.
        const plan = planReplace(props.attachments, targetId(props.attachments, target))
        if (!plan) { reject(replaceError('gone')); return }
        const op = { phase: 'removing', removed: plan.removed, files: [file, ...plan.removed.slice(1).map((item) => item.file)], resolve, reject }
        pending.current = op
        op.timer = setTimeout(() => restore(op, 'locked'), REMOVE_CONFIRM_MS)
        for (const item of plan.removed) props.onRemoveAttachment(item.id)
        setTick((tick) => tick + 1)
      }), [restore])
    }

    function createWrapper(Native, t) {
      return function ImageAnnotateAttachments(props) {
        const host = useRef(null)
        const latest = useRef(props)
        latest.current = props
        const clickTimer = useRef(0)
        const [editing, setEditing] = useState(null)
        const replace = useReplacement(latest)

        useEffect(() => () => clearTimeout(clickTimer.current), [])

        // Mark editable thumbnails for the hover pencil and tooltip.
        useLayoutEffect(() => {
          const root = host.current
          if (!root) return
          for (const image of root.querySelectorAll('button > img')) {
            const found = findThumbnail(image, root, props.attachments, props.uploads)
            if (!found) continue
            if (!found.button.hasAttribute('data-image-annotate-editable')) found.button.setAttribute('data-image-annotate-editable', '')
            const title = t('thumbTitle')
            if (found.button.title !== title) found.button.title = title
          }
        })

        const open = (found) => {
          clearTimeout(clickTimer.current)
          setEditing({ id: found.attachment.id, file: found.attachment.file, opener: found.button })
        }

        const onClickCapture = (event) => {
          // detail 0: keyboard activation or our replayed click — native preview.
          if (event.detail === 0 || editing) return
          const found = findThumbnail(event.target, host.current, latest.current.attachments, latest.current.uploads)
          if (!found) return
          event.stopPropagation()
          event.preventDefault()
          clearTimeout(clickTimer.current)
          if (event.detail > 1) return
          const button = found.button
          clickTimer.current = setTimeout(() => { if (button.isConnected) button.click() }, DOUBLE_CLICK_MS)
        }
        const onDoubleClickCapture = (event) => {
          const found = findThumbnail(event.target, host.current, latest.current.attachments, latest.current.uploads)
          if (!found) return
          event.stopPropagation()
          event.preventDefault()
          open(found)
        }
        const onKeyDownCapture = (event) => {
          if (event.key !== 'e' && event.key !== 'E') return
          if (event.metaKey || event.ctrlKey || event.altKey) return
          const found = findThumbnail(event.target, host.current, latest.current.attachments, latest.current.uploads)
          if (!found || event.target !== found.button) return
          event.preventDefault()
          event.stopPropagation()
          open(found)
        }

        const editingRef = useRef(null)
        editingRef.current = editing
        const close = useCallback((saved) => {
          const opener = editingRef.current?.opener
          setEditing(null)
          // After a save the opener thumbnail is gone; the new one is unfocused like a fresh drop.
          if (!saved && opener?.isConnected) setTimeout(() => opener.focus({ preventScroll: true }), 0)
        }, [])

        const save = useCallback((file) => replace(editingRef.current, file), [replace])

        return h('div', { ref: host, 'data-image-annotate': '', style: { display: 'contents' }, onClickCapture, onDoubleClickCapture, onKeyDownCapture },
          h(Native, props),
          editing && h(Editor, { key: editing.id, file: editing.file, t, onSave: save, onClose: close }))
      }
    }

    // ---- Editor ----------------------------------------------------------------

    function Editor({ file, t, onSave, onClose }) {
      const rootRef = useRef(null)
      const stageRef = useRef(null)
      const canvasRef = useRef(null)
      const textRef = useRef(null)
      const [image, setImage] = useState(null)
      const [failed, setFailed] = useState(false)
      const [doc, setDoc] = useState(() => history())
      const [live, setLive] = useState(null)
      const [tool, setTool] = useState('rect')
      const [color, setColor] = useState(COLORS[0])
      const [sizeKey, setSizeKey] = useState('m')
      const [selected, setSelected] = useState(null)
      const [textEdit, setTextEdit] = useState(null)
      const [scale, setScale] = useState(1)
      const [saving, setSaving] = useState(false)
      const [status, setStatus] = useState(null)
      const [confirming, setConfirming] = useState(false)
      const [hover, setHover] = useState(false)
      const gesture = useRef(null)
      const idSeq = useRef(0)
      const frame = useRef(0)

      const width = image?.naturalWidth || 1
      const height = image?.naturalHeight || 1
      const unit = unitFor(width, height)
      const shapes = live || doc.shapes
      const dirty = doc.shapes.length > 0 || textEdit !== null
      const selectedShape = shapes.find((shape) => shape.id === selected) || null

      // Load from our own object URL; the composer revokes its preview URL on removal.
      useEffect(() => {
        const url = URL.createObjectURL(file)
        const element = new Image()
        let cancelled = false
        element.onload = () => { if (!cancelled) setImage(element) }
        element.onerror = () => { if (!cancelled) setFailed(true) }
        element.src = url
        return () => { cancelled = true; URL.revokeObjectURL(url) }
      }, [file])

      // Take focus so keystrokes never reach the composer's draft editor.
      useEffect(() => { rootRef.current?.focus({ preventScroll: true }) }, [])

      // Fit the image into the stage; small images may scale up to 2x.
      useLayoutEffect(() => {
        const stage = stageRef.current
        if (!stage || !image) return
        const fit = () => {
          const box = stage.getBoundingClientRect()
          const next = Math.min((box.width - 48) / width, (box.height - 16) / height, 2)
          setScale(Math.max(0.02, next))
        }
        fit()
        const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null
        observer?.observe(stage)
        window.addEventListener('resize', fit)
        return () => { observer?.disconnect(); window.removeEventListener('resize', fit) }
      }, [image, width, height])

      const paint = useCallback(() => {
        const canvas = canvasRef.current
        if (!canvas || !image) return
        const dpr = window.devicePixelRatio || 1
        const cw = Math.max(1, Math.round(width * scale * dpr)), ch = Math.max(1, Math.round(height * scale * dpr))
        if (canvas.width !== cw) canvas.width = cw
        if (canvas.height !== ch) canvas.height = ch
        const c = canvas.getContext('2d')
        c.setTransform(1, 0, 0, 1, 0, 0)
        c.clearRect(0, 0, cw, ch)
        c.setTransform(cw / width, 0, 0, ch / height, 0, 0)
        c.imageSmoothingEnabled = true
        c.imageSmoothingQuality = 'high'
        c.drawImage(image, 0, 0, width, height)
        const editingId = textEdit?.id
        for (const shape of shapes) if (shape.id !== editingId) drawShape(c, shape, image)
        const draft = gesture.current?.draft
        if (draft) drawShape(c, draft, image)
        if (selectedShape && tool === 'select' && selectedShape.id !== editingId) drawSelection(c, shapeBounds(selectedShape, measureText), 1 / scale)
      }, [image, width, height, scale, shapes, textEdit, selectedShape, tool])

      useLayoutEffect(() => { paint() }, [paint])
      const schedulePaint = () => {
        cancelAnimationFrame(frame.current)
        frame.current = requestAnimationFrame(() => paint())
      }
      useEffect(() => () => cancelAnimationFrame(frame.current), [])

      const commit = (next) => setDoc((current) => pushHistory(current, typeof next === 'function' ? next(current.shapes) : next))
      const newId = () => `s${++idSeq.current}`

      const toImage = (event) => {
        const rect = canvasRef.current.getBoundingClientRect()
        return [(event.clientX - rect.left) / rect.width * width, (event.clientY - rect.top) / rect.height * height]
      }
      const tolerance = () => 6 / scale

      // ---- Text editing ----
      const textState = useRef(null)
      textState.current = textEdit
      const commitText = () => {
        const edit = textState.current
        if (!edit) return
        textState.current = null
        setTextEdit(null)
        const text = edit.text.replace(/\s+$/, '')
        commit((list) => {
          const index = edit.id ? list.findIndex((shape) => shape.id === edit.id) : -1
          if (text.trim() === '') return index >= 0 ? list.filter((_, i) => i !== index) : list
          const shape = { id: edit.id || newId(), type: 'text', x: edit.x, y: edit.y, text, color: edit.color, size: edit.size, sizeKey: edit.sizeKey }
          if (index >= 0) {
            const old = list[index]
            if (old.text === shape.text && old.color === shape.color && old.size === shape.size) return list
            return list.map((item, i) => i === index ? shape : item)
          }
          return [...list, shape]
        })
        rootRef.current?.focus({ preventScroll: true })
      }
      const cancelText = () => {
        textState.current = null
        setTextEdit(null)
        rootRef.current?.focus({ preventScroll: true })
      }
      const startText = (x, y, existing) => {
        if (existing) {
          setSelected(existing.id)
          setColor(existing.color)
          if (existing.sizeKey) setSizeKey(existing.sizeKey)
          setTextEdit({ id: existing.id, x: existing.x, y: existing.y, text: existing.text, color: existing.color, size: existing.size, sizeKey: existing.sizeKey })
        } else {
          const size = sizeValue('text', sizeKey, unit)
          setTextEdit({ id: null, x, y: y - size * LINE_HEIGHT / 2, text: '', color, size, sizeKey })
        }
      }
      useEffect(() => {
        if (!textEdit) return
        const area = textRef.current
        if (area && document.activeElement !== area) { area.focus({ preventScroll: true }); area.setSelectionRange(area.value.length, area.value.length) }
      }, [textEdit !== null])

      // ---- Pointer gestures ----
      const onPointerDown = (event) => {
        if (event.button !== 0 || !image || saving) return
        event.preventDefault()
        if (textState.current) { commitText(); return }
        const [x, y] = toImage(event)
        const hit = pick(shapes, x, y, tolerance(), measureText)
        if (tool === 'select') {
          if (!hit) { setSelected(null); return }
          setSelected(hit.id)
          setColor(hit.type === 'mosaic' ? color : hit.color)
          if (hit.sizeKey) setSizeKey(hit.sizeKey)
          gesture.current = { kind: 'move', id: hit.id, start: [x, y], base: doc.shapes, moved: false }
        } else if (tool === 'text') {
          startText(x, y, hit?.type === 'text' ? hit : null)
          return
        } else if (tool === 'marker') {
          const shape = { id: newId(), type: 'marker', x, y, r: sizeValue('marker', sizeKey, unit), n: nextMarkerNumber(doc.shapes), color, sizeKey }
          commit((list) => [...list, shape])
          return
        } else if (tool === 'pen' || tool === 'highlighter') {
          gesture.current = { kind: 'draw', draft: { id: newId(), type: tool, points: [[x, y]], width: sizeValue(tool, sizeKey, unit), color, sizeKey } }
        } else {
          const draft = { id: newId(), type: tool, x1: x, y1: y, x2: x, y2: y, color, sizeKey }
          if (tool === 'mosaic') draft.block = sizeValue('mosaic', sizeKey, unit)
          else draft.width = sizeValue(tool, sizeKey, unit)
          gesture.current = { kind: 'draw', draft }
        }
        try { event.currentTarget.setPointerCapture(event.pointerId) } catch {}
        schedulePaint()
      }
      const onPointerMove = (event) => {
        const current = gesture.current
        if (!image) return
        const [x, y] = toImage(event)
        if (!current) {
          if (tool === 'select') setHover(pick(shapes, x, y, tolerance(), measureText) !== null)
          return
        }
        if (current.kind === 'move') {
          const dx = x - current.start[0], dy = y - current.start[1]
          if (!current.moved && Math.hypot(dx, dy) * scale < 2) return
          current.moved = true
          current.result = current.base.map((shape) => shape.id === current.id ? translate(shape, dx, dy) : shape)
          setLive(current.result)
          return
        }
        const draft = current.draft
        if (draft.type === 'pen' || draft.type === 'highlighter') {
          const last = draft.points[draft.points.length - 1]
          if (Math.hypot(x - last[0], y - last[1]) * scale >= 0.75) draft.points.push([x, y])
        } else {
          const end = constrain(draft.type, draft.x1, draft.y1, x, y, event.shiftKey)
          draft.x2 = end.x2; draft.y2 = end.y2
        }
        schedulePaint()
      }
      const onPointerUp = () => {
        const current = gesture.current
        gesture.current = null
        if (!current) return
        if (current.kind === 'move') {
          if (current.moved && current.result) commit(current.result)
          setLive(null)
          return
        }
        const draft = current.draft
        if (isMeaningful(draft, 3 / scale)) {
          const shape = { ...draft, points: draft.points ? draft.points.slice() : undefined }
          if (!shape.points) delete shape.points
          commit((list) => [...list, shape])
        } else schedulePaint()
      }
      const onDoubleClick = (event) => {
        if (!image || tool !== 'select') return
        const [x, y] = toImage(event)
        const hit = pick(shapes, x, y, tolerance(), measureText)
        if (hit?.type === 'text') startText(hit.x, hit.y, hit)
      }

      // ---- Commands ----
      const undo = () => { if (textState.current) cancelText(); setSelected(null); setDoc(undoHistory) }
      const redo = () => { setSelected(null); setDoc(redoHistory) }
      const removeSelected = () => {
        if (!selected) return
        commit((list) => list.filter((shape) => shape.id !== selected))
        setSelected(null)
      }
      const clearAll = () => { if (doc.shapes.length) { commit([]); setSelected(null) } }
      const chooseColor = (value) => {
        setColor(value)
        if (textState.current) setTextEdit((edit) => edit && { ...edit, color: value })
        else if (selectedShape && selectedShape.type !== 'mosaic') commit((list) => list.map((shape) => shape.id === selected ? restyle(shape, { color: value }, unit) : shape))
      }
      const chooseSize = (value) => {
        setSizeKey(value)
        if (textState.current) setTextEdit((edit) => edit && { ...edit, sizeKey: value, size: sizeValue('text', value, unit) })
        else if (selectedShape) commit((list) => list.map((shape) => shape.id === selected ? restyle(shape, { sizeKey: value }, unit) : shape))
      }
      const chooseTool = (value) => {
        if (textState.current) commitText()
        setTool(value)
        if (value !== 'select') setSelected(null)
      }
      const requestClose = () => {
        if (saving) return
        if (dirty) setConfirming(true)
        else onClose(false)
      }
      const save = async () => {
        if (saving || !image) return
        let finalShapes = doc.shapes
        const edit = textState.current
        if (edit) {
          commitText()
          const text = edit.text.replace(/\s+$/, '')
          const rest = edit.id ? finalShapes.filter((shape) => shape.id !== edit.id) : finalShapes
          finalShapes = text.trim() ? [...rest, { id: edit.id || 'pending', type: 'text', x: edit.x, y: edit.y, text, color: edit.color, size: edit.size }] : rest
        }
        if (finalShapes.length === 0) { onClose(false); return }
        setSaving(true)
        setStatus({ kind: 'info', text: t('saving') })
        try {
          const output = await exportAnnotated(image, finalShapes, file)
          await onSave(output)
          onClose(true)
        } catch (error) {
          setSaving(false)
          const code = error?.code && ZH[`error.${error.code}`] ? error.code : 'encode'
          setStatus({ kind: 'error', text: t(`error.${code}`) })
        }
      }

      // ---- Keyboard: owned at window capture so global shortcuts never fire behind the editor ----
      const keys = useRef(null)
      keys.current = { undo, redo, save, removeSelected, chooseTool, requestClose, commitText, cancelText, confirming, setConfirming, onClose, selected, setSelected, saving, nudge: (dx, dy) => {
        if (!selectedShape) return
        commit((list) => list.map((shape) => shape.id === selected ? translate(shape, dx, dy) : shape))
      }, scale }
      useEffect(() => {
        const onKey = (event) => {
          const root = rootRef.current
          if (!root) return
          event.stopPropagation()
          if (event.type !== 'keydown') return
          const k = keys.current
          const inText = event.target === textRef.current
          if (inText) {
            if (event.isComposing || event.keyCode === 229) return
            if (event.key === 'Escape') { event.preventDefault(); k.cancelText() }
            else if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); k.commitText() }
            return
          }
          if (k.confirming) {
            if (event.key === 'Escape') { event.preventDefault(); k.setConfirming(false) }
            return
          }
          const mod = event.metaKey || event.ctrlKey
          const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
          if (mod && key === 'z') { event.preventDefault(); if (event.shiftKey) k.redo(); else k.undo(); return }
          if (mod && key === 'y') { event.preventDefault(); k.redo(); return }
          if (mod && (key === 's' || key === 'Enter')) { event.preventDefault(); k.save(); return }
          if (k.saving) return
          if (key === 'Escape') { event.preventDefault(); if (k.selected) k.setSelected(null); else k.requestClose(); return }
          if ((key === 'Delete' || key === 'Backspace') && k.selected) { event.preventDefault(); k.removeSelected(); return }
          if (key.startsWith?.('Arrow') && k.selected) {
            event.preventDefault()
            const step = (event.shiftKey ? 10 : 1) / k.scale
            k.nudge(key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0, key === 'ArrowUp' ? -step : key === 'ArrowDown' ? step : 0)
            return
          }
          if (!mod && !event.altKey) {
            const match = TOOLS.find((item) => item.key === key)
            if (match) { event.preventDefault(); k.chooseTool(match.id) }
          }
        }
        const swallow = (event) => { event.stopPropagation() }
        const blockDrop = (event) => { event.stopPropagation(); if (event.type !== 'dragenter' && event.type !== 'dragleave') event.preventDefault() }
        const keyEvents = ['keydown', 'keyup', 'keypress']
        const dropEvents = ['dragenter', 'dragover', 'dragleave', 'drop']
        for (const name of keyEvents) window.addEventListener(name, onKey, true)
        window.addEventListener('paste', swallow, true)
        for (const name of dropEvents) window.addEventListener(name, blockDrop, true)
        return () => {
          for (const name of keyEvents) window.removeEventListener(name, onKey, true)
          window.removeEventListener('paste', swallow, true)
          for (const name of dropEvents) window.removeEventListener(name, blockDrop, true)
        }
      }, [])

      // Contain React bubbling inside the editor so composer handlers ignore it.
      const stop = (event) => { event.stopPropagation() }

      const toolButton = (item) => h('button', {
        key: item.id, type: 'button', className: 'dia-btn', 'aria-pressed': tool === item.id,
        title: `${t(`tool.${item.id}`)} (${item.key.toUpperCase()})`, 'aria-label': t(`tool.${item.id}`),
        'data-tool': item.id, onClick: () => chooseTool(item.id),
      }, h(Icon, { name: item.id }))

      const textArea = () => {
        if (!textEdit) return null
        const layout = textLayout({ ...textEdit, text: textEdit.text || ' ' }, measureText)
        const placeholderWidth = measureText(t('textPlaceholder'), textEdit.size)
        return h('textarea', {
          ref: textRef, className: 'dia-textarea', value: textEdit.text, placeholder: t('textPlaceholder'), spellCheck: false,
          rows: layout.lines.length, wrap: 'off',
          style: {
            left: `${textEdit.x * scale}px`, top: `${textEdit.y * scale}px`,
            width: `${Math.max(layout.width, textEdit.text ? 0 : placeholderWidth) * scale + 12}px`,
            height: `${layout.height * scale}px`,
            fontSize: `${textEdit.size * scale}px`, lineHeight: `${textEdit.size * LINE_HEIGHT * scale}px`, color: textEdit.color,
          },
          onChange: (event) => { const text = event.target.value; setTextEdit((edit) => edit && { ...edit, text }) },
          onBlur: () => commitText(),
        })
      }

      const body = h('div', {
        ref: rootRef, className: 'dia-root', role: 'dialog', 'aria-modal': true, 'aria-label': t('title'), tabIndex: -1,
        'data-image-annotate-editor': '',
        onPointerDown: stop, onMouseDown: stop, onClick: stop, onDoubleClick: stop, onContextMenu: stop, onWheel: stop,
      },
        h('div', { className: 'dia-header' },
          h('div', { className: 'dia-heading' },
            h('span', { className: 'dia-title' }, t('title')),
            h('span', { className: 'dia-sub', title: file.name }, [file.name, t('subtitle')].filter(Boolean).join(' · '))),
          h('button', { type: 'button', className: 'dia-btn', title: `${t('undo')} (⌘/Ctrl+Z)`, 'aria-label': t('undo'), disabled: saving || doc.past.length === 0, onClick: undo, 'data-action': 'undo' }, h(Icon, { name: 'undo' })),
          h('button', { type: 'button', className: 'dia-btn', title: `${t('redo')} (⇧⌘/Ctrl+Shift+Z)`, 'aria-label': t('redo'), disabled: saving || doc.future.length === 0, onClick: redo, 'data-action': 'redo' }, h(Icon, { name: 'redo' })),
          h('button', { type: 'button', className: 'dia-btn', title: `${t('remove')} (Delete)`, 'aria-label': t('remove'), disabled: saving || !selectedShape || tool !== 'select', onClick: removeSelected, 'data-action': 'remove' }, h(Icon, { name: 'remove' })),
          h('button', { type: 'button', className: 'dia-btn', title: t('clear'), 'aria-label': t('clear'), disabled: saving || doc.shapes.length === 0, onClick: clearAll, 'data-action': 'clear' }, h(Icon, { name: 'clear' })),
          h('span', { className: 'dia-sep' }),
          h('button', { type: 'button', className: 'dia-btn dia-text-btn', disabled: saving, onClick: requestClose, 'data-action': 'cancel' }, t('cancel')),
          h('button', { type: 'button', className: 'dia-btn dia-text-btn dia-primary', title: `${t('save')} (⌘/Ctrl+S)`, disabled: saving || !image, onClick: save, 'data-action': 'save' }, saving ? t('saving') : t('save'))),
        h('div', { ref: stageRef, className: 'dia-stage' },
          status && h('div', { className: 'dia-status', 'data-kind': status.kind, role: status.kind === 'error' ? 'alert' : 'status' }, status.text),
          failed ? h('div', { className: 'dia-status', 'data-kind': 'error', role: 'alert' }, t('loadFailed'))
            : !image ? h('div', { className: 'dia-sub' }, t('loading'))
              : h('div', { className: 'dia-canvas-wrap', style: { width: `${width * scale}px`, height: `${height * scale}px` } },
                h('canvas', {
                  ref: canvasRef, className: 'dia-canvas', 'data-tool': tool, 'data-hover': tool === 'select' && hover ? 'move' : undefined,
                  style: { width: `${width * scale}px`, height: `${height * scale}px` },
                  onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp, onDoubleClick,
                }),
                textArea())),
        h('div', { className: 'dia-toolbar', role: 'toolbar', 'aria-label': t('title') },
          h('div', { className: 'dia-group' }, TOOLS.map(toolButton)),
          h('span', { className: 'dia-sep' }),
          h('div', { className: 'dia-group' }, COLORS.map((value) => h('button', {
            key: value, type: 'button', className: 'dia-swatch', 'aria-pressed': color === value, title: t('color', { color: value }), 'aria-label': t('color', { color: value }),
            'data-color': value, onClick: () => chooseColor(value),
          }, h('span', { style: { background: value } })))),
          h('span', { className: 'dia-sep' }),
          h('div', { className: 'dia-group' }, SIZE_KEYS.map((value, index) => h('button', {
            key: value, type: 'button', className: 'dia-btn', 'aria-pressed': sizeKey === value, title: t(`size.${value}`), 'aria-label': t(`size.${value}`),
            'data-size': value, onClick: () => chooseSize(value),
          }, h('span', { className: 'dia-dot', style: { width: `${4 + index * 4}px`, height: `${4 + index * 4}px` } }))))),
        h('div', { className: 'dia-hint' }, t('hint')),
        confirming && h('div', { className: 'dia-confirm' },
          h('div', { className: 'dia-dialog', role: 'alertdialog', 'aria-label': t('confirmTitle') },
            h('p', null, t('confirmTitle')),
            h('div', { className: 'dia-actions' },
              h('button', { type: 'button', className: 'dia-btn dia-text-btn', onClick: () => setConfirming(false), 'data-action': 'keep', autoFocus: true }, t('keepEditing')),
              h('button', { type: 'button', className: 'dia-btn dia-text-btn dia-danger', onClick: () => onClose(false), 'data-action': 'discard' }, t('discard'))))))

      return ReactDOM?.createPortal ? ReactDOM.createPortal(body, document.body) : body
    }

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), '[image-annotate] locale')
      const t = ctx.locale.bind(NS)
      ctx.effect(() => ensureStyle(), '[image-annotate] style')
      ctx.effect(() => ctx.slots.inject(SLOT, () => registerReplacement(ctx, SLOT, OWN_ID, (Native) => createWrapper(Native, t))), '[image-annotate] composer attachments')
    }

    return {
      name: TYPE,
      inject: ['slots', 'locale'],
      apply,
      // Test surface.
      outputType, outputName, planReplace, targetId, unitFor, sizeValue, restyle, nextMarkerNumber, constrain, distToSegment,
      textLayout, shapeBounds, hitTest, pick, translate, isMeaningful, luminance, history, pushHistory, undoHistory, redoHistory,
      findThumbnail, registerReplacement, ZH, EN, TOOLS, COLORS, SLOT, OWN_ID,
    }
  },
})
