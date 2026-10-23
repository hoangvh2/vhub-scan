package com.vhub.scan

import com.vhub.scan.core.Geometry
import com.vhub.scan.core.OutSize
import com.vhub.scan.core.Pt
import org.opencv.core.Core
import org.opencv.core.CvType
import org.opencv.core.Mat
import org.opencv.core.MatOfPoint
import org.opencv.core.MatOfPoint2f
import org.opencv.core.Point
import org.opencv.core.Scalar
import org.opencv.core.Size
import org.opencv.imgcodecs.Imgcodecs
import org.opencv.imgproc.Imgproc
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

enum class Kind { BGR, GRAY, BINARY }

class Rendered(val mat: Mat, val kind: Kind, val size: OutSize)

/**
 * OpenCV pipeline. Tiers refer to docs/RESEARCH.md §3.1:
 *  T0 geometry (one resample from the original), T1 flatten, T2 experimental local filters, T3 binarise.
 * Nothing here generates content; there is no denoise and no learned model.
 */
object Imaging {
    private const val STRIP = 512

    fun loadFull(path: String): Mat {
        val m = Imgcodecs.imread(path, Imgcodecs.IMREAD_COLOR) // applies EXIF orientation
        require(!m.empty()) { "Cannot decode $path" }
        return m
    }

    /** Fast reduced decode (JPEG DCT scaling) for UI preview / corner detection, long side <= [maxSide]. */
    fun loadPreview(path: String, maxSide: Int = 1600): Mat {
        var m = Imgcodecs.imread(path, Imgcodecs.IMREAD_REDUCED_COLOR_4)
        if (m.empty()) m = Imgcodecs.imread(path, Imgcodecs.IMREAD_COLOR)
        require(!m.empty()) { "Cannot decode $path" }
        val longSide = max(m.cols(), m.rows())
        if (longSide > maxSide) {
            val s = maxSide.toDouble() / longSide
            val r = Mat()
            Imgproc.resize(m, r, Size(), s, s, Imgproc.INTER_AREA)
            m.release()
            m = r
        }
        return m
    }

    // ---------------------------------------------------------------- corner detection (classical)

    /** Returns normalised TL,TR,BR,BL (8 doubles). Heuristic baseline; the user can always adjust. */
    fun detectCorners(bgr: Mat): DoubleArray {
        val longSide = max(bgr.cols(), bgr.rows())
        val s = min(1.0, 800.0 / longSide)
        val work = Mat()
        Imgproc.resize(bgr, work, Size(), s, s, Imgproc.INTER_AREA)
        val gray = Mat()
        Imgproc.cvtColor(work, gray, Imgproc.COLOR_BGR2GRAY)
        Imgproc.GaussianBlur(gray, gray, Size(5.0, 5.0), 0.0)
        val area = work.cols().toDouble() * work.rows()

        fun bestQuad(binary: Mat): List<Pt>? {
            val contours = ArrayList<MatOfPoint>()
            Imgproc.findContours(binary, contours, Mat(), Imgproc.RETR_LIST, Imgproc.CHAIN_APPROX_SIMPLE)
            for (c in contours.sortedByDescending { Imgproc.contourArea(it) }.take(8)) {
                if (Imgproc.contourArea(c) < 0.15 * area) break
                val c2f = MatOfPoint2f(*c.toArray())
                val peri = Imgproc.arcLength(c2f, true)
                val approx = MatOfPoint2f()
                Imgproc.approxPolyDP(c2f, approx, 0.02 * peri, true)
                val pts = approx.toArray()
                if (pts.size == 4 && Imgproc.isContourConvex(MatOfPoint(*pts))) {
                    return Geometry.orderCorners(pts.map { Pt(it.x, it.y) })
                }
            }
            // fallback: min-area rect of the largest blob
            val biggest = contours.maxByOrNull { Imgproc.contourArea(it) } ?: return null
            if (Imgproc.contourArea(biggest) < 0.15 * area) return null
            val rr = Imgproc.minAreaRect(MatOfPoint2f(*biggest.toArray()))
            val box = arrayOf(Point(), Point(), Point(), Point())
            rr.points(box)
            return Geometry.orderCorners(box.map { Pt(it.x, it.y) })
        }

        var quad: List<Pt>? = null
        // 1) edges
        val edges = Mat()
        val med = medianOf(gray)
        Imgproc.Canny(gray, edges, max(0.0, 0.66 * med), min(255.0, 1.33 * med))
        Imgproc.dilate(edges, edges, Imgproc.getStructuringElement(Imgproc.MORPH_RECT, Size(3.0, 3.0)))
        quad = bestQuad(edges)
        // 2) bright-page threshold
        if (quad == null) {
            val bin = Mat()
            Imgproc.threshold(gray, bin, 0.0, 255.0, Imgproc.THRESH_BINARY or Imgproc.THRESH_OTSU)
            Imgproc.morphologyEx(bin, bin, Imgproc.MORPH_CLOSE, Imgproc.getStructuringElement(Imgproc.MORPH_RECT, Size(15.0, 15.0)))
            quad = bestQuad(bin)
            bin.release()
        }
        work.release(); gray.release(); edges.release()

        val w = bgr.cols() * s
        val h = bgr.rows() * s
        return if (quad == null) {
            doubleArrayOf(0.05, 0.05, 0.95, 0.05, 0.95, 0.95, 0.05, 0.95)
        } else {
            DoubleArray(8) { i -> val p = quad[i / 2]; if (i % 2 == 0) (p.x / w).coerceIn(0.0, 1.0) else (p.y / h).coerceIn(0.0, 1.0) }
        }
    }

    private fun medianOf(gray: Mat): Double {
        val hist = IntArray(256)
        val small = Mat()
        Imgproc.resize(gray, small, Size(64.0, 64.0))
        val b = ByteArray(64 * 64)
        small.get(0, 0, b)
        for (v in b) hist[v.toInt() and 0xFF]++
        var acc = 0
        for (i in 0 until 256) { acc += hist[i]; if (acc >= b.size / 2) { small.release(); return i.toDouble() } }
        small.release()
        return 128.0
    }

    // ---------------------------------------------------------------- render

    fun render(src: Mat, spec: EditSpec): Rendered {
        val pts = (0 until 4).map { Pt(spec.corners[it * 2] * src.cols(), spec.corners[it * 2 + 1] * src.rows()) }
        val q = Geometry.orderCorners(pts)
        val size = Geometry.outputSize(q, spec.paper)

        // T0: single Lanczos resample straight from the original pixels.
        val srcPts = MatOfPoint2f(*q.map { Point(it.x, it.y) }.toTypedArray())
        val w = size.widthPx.toDouble()
        val h = size.heightPx.toDouble()
        val dstPts = MatOfPoint2f(Point(0.0, 0.0), Point(w - 1, 0.0), Point(w - 1, h - 1), Point(0.0, h - 1))
        val m = Imgproc.getPerspectiveTransform(srcPts, dstPts)
        var cur = Mat()
        Imgproc.warpPerspective(src, cur, m, Size(w, h), Imgproc.INTER_LANCZOS4, Core.BORDER_REPLICATE)

        var kind = Kind.BGR
        if (spec.mode == ScanMode.GRAY || spec.mode == ScanMode.BW) {
            val g = Mat()
            // BT.709 luma, fixed weights (OpenCV BGR order).
            val k = Mat(1, 3, CvType.CV_32F)
            k.put(0, 0, 0.0722, 0.7152, 0.2126)
            Core.transform(cur, g, k)
            cur.release(); cur = g; kind = Kind.GRAY
        }
        if (spec.mode != ScanMode.ORIGINAL && spec.flatten) flatten(cur)
        if (spec.unsharpAmount > 0.0 && spec.mode != ScanMode.ORIGINAL) unsharp(cur, spec.unsharpAmount, spec.unsharpRadius)
        if (spec.clahe && spec.mode != ScanMode.ORIGINAL) claheInPlace(cur, kind)
        if (spec.mode == ScanMode.BW) {
            val win = oddAtLeast((min(cur.cols(), cur.rows()) * spec.sauvolaWindowFrac).roundToInt(), 15)
            val bw = sauvola(cur, spec.sauvolaK, win)
            cur.release(); cur = bw; kind = Kind.BINARY
        }
        return Rendered(cur, kind, size)
    }

    private fun oddAtLeast(v: Int, lo: Int): Int = max(v, lo) or 1

    /**
     * T1 illumination normalisation: estimate the page background on a small image
     * (dilate removes dark ink, blur smooths), upscale, and divide every channel by it.
     * Same gain for all channels, so hue is preserved. Gain is capped to avoid amplifying noise in deep shadow.
     */
    fun flatten(img: Mat) {
        val gray = if (img.channels() == 1) img else Mat().also { Imgproc.cvtColor(img, it, Imgproc.COLOR_BGR2GRAY) }
        val s = 512.0 / max(img.cols(), img.rows())
        val small = Mat()
        Imgproc.resize(gray, small, Size(), min(1.0, s), min(1.0, s), Imgproc.INTER_AREA)
        if (gray !== img) gray.release()
        Imgproc.dilate(small, small, Imgproc.getStructuringElement(Imgproc.MORPH_ELLIPSE, Size(9.0, 9.0)))
        Imgproc.GaussianBlur(small, small, Size(0.0, 0.0), 6.0)
        val bg = Mat()
        Imgproc.resize(small, bg, Size(img.cols().toDouble(), img.rows().toDouble()), 0.0, 0.0, Imgproc.INTER_LINEAR)
        small.release()
        Core.max(bg, Scalar(MIN_BG), bg)
        var r = 0
        while (r < img.rows()) {
            val r1 = min(img.rows(), r + STRIP)
            val strip = img.rowRange(r, r1)
            val b = bg.rowRange(r, r1)
            val b3 = if (img.channels() == 3) Mat().also { Core.merge(listOf(b, b, b), it) } else b
            Core.divide(strip, b3, strip, 255.0, -1)
            if (b3 !== b) b3.release()
            r = r1
        }
        bg.release()
    }

    private const val MIN_BG = 60.0

    /** T2 (experimental, default off): classic unsharp mask. */
    private fun unsharp(img: Mat, amount: Double, radius: Double) {
        val blur = Mat()
        Imgproc.GaussianBlur(img, blur, Size(0.0, 0.0), radius)
        Core.addWeighted(img, 1.0 + amount, blur, -amount, 0.0, img)
        blur.release()
    }

    /** T2 (experimental, default off): CLAHE on luma. */
    private fun claheInPlace(img: Mat, kind: Kind) {
        val clahe = Imgproc.createCLAHE(2.0, Size(8.0, 8.0))
        if (kind == Kind.GRAY) {
            clahe.apply(img, img)
        } else {
            val lab = Mat()
            Imgproc.cvtColor(img, lab, Imgproc.COLOR_BGR2Lab)
            val ch = ArrayList<Mat>()
            Core.split(lab, ch)
            clahe.apply(ch[0], ch[0])
            Core.merge(ch, lab)
            Imgproc.cvtColor(lab, img, Imgproc.COLOR_Lab2BGR)
            ch.forEach { it.release() }
            lab.release()
        }
    }

    /**
     * T3: Sauvola local threshold, T = mean * (1 + k * (std/128 - 1)), computed in padded strips to bound memory.
     * Output: 255 = paper, 0 = ink.
     */
    fun sauvola(gray: Mat, k: Double, win: Int): Mat {
        val out = Mat(gray.rows(), gray.cols(), CvType.CV_8UC1)
        val half = win / 2 + 1
        val ksize = Size(win.toDouble(), win.toDouble())
        var r = 0
        while (r < gray.rows()) {
            val r1 = min(gray.rows(), r + STRIP)
            val a = max(0, r - half)
            val b = min(gray.rows(), r1 + half)
            val f = Mat()
            gray.rowRange(a, b).convertTo(f, CvType.CV_32F)
            val mean = Mat()
            Imgproc.boxFilter(f, mean, CvType.CV_32F, ksize, Point(-1.0, -1.0), true, Core.BORDER_REPLICATE)
            val sq = Mat()
            Core.multiply(f, f, sq)
            val sqMean = Mat()
            Imgproc.boxFilter(sq, sqMean, CvType.CV_32F, ksize, Point(-1.0, -1.0), true, Core.BORDER_REPLICATE)
            val m2 = Mat()
            Core.multiply(mean, mean, m2)
            Core.subtract(sqMean, m2, sqMean)
            Core.max(sqMean, Scalar(0.0), sqMean)
            val std = Mat()
            Core.sqrt(sqMean, std)
            val t = Mat()
            Core.multiply(std, Scalar(k / 128.0), t)
            Core.add(t, Scalar(1.0 - k), t)
            val thr = Mat()
            Core.multiply(mean, t, thr)
            val mask = Mat()
            Core.compare(f, thr, mask, Core.CMP_GT)
            mask.rowRange(r - a, r1 - a).copyTo(out.rowRange(r, r1))
            listOf(f, mean, sq, sqMean, m2, std, t, thr, mask).forEach { it.release() }
            r = r1
        }
        return out
    }
}
