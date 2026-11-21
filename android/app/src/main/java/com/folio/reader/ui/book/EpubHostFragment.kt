package com.folio.reader.ui.book

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.fragment.app.Fragment
import androidx.fragment.app.FragmentContainerView
import androidx.fragment.app.FragmentFactory
import androidx.lifecycle.lifecycleScope
import com.folio.reader.FolioApp
import com.folio.reader.R
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.readium.r2.shared.publication.Locator
import org.readium.r2.shared.publication.Publication
import org.readium.r2.navigator.epub.EpubNavigatorFactory
import org.readium.r2.navigator.epub.EpubNavigatorFragment
import org.readium.r2.navigator.epub.EpubPreferences
import org.readium.r2.navigator.preferences.Theme

/**
 * Readium 的宿主 Fragment。
 *
 * 解析、分页、目录、样式全在 [EpubNavigatorFragment] 里；这里只做三件事：
 * 1. 用 [EpubNavigatorFactory] 生成子 Fragment 工厂（**必须在 super.onCreate 之前**，
 *    子 Fragment 的状态恢复发生在 `super.onCreate` 里）；
 * 2. 挂一个 [FragmentContainerView]；
 * 3. 离开页面时把位置写进本机 `epub-progress.json`。
 */
class EpubHostFragment : Fragment() {

    override fun onCreate(savedInstanceState: Bundle?) {
        val bookId = arguments?.getString(ARG_BOOK_ID)
        val dark = arguments?.getBoolean(ARG_DARK) == true
        val container = (requireActivity().application as FolioApp).container
        val publication = bookId?.let { container.epubLibrary.publicationOf(it) }

        if (bookId != null && publication != null) {
            // 桌面端更新过进度（带 initialFraction）时按全书比例落位；
            // 否则用本机上次的 locator，连 chapter 内位置都能精确还原。
            val fraction = arguments?.let {
                if (it.containsKey(ARG_FRACTION)) it.getDouble(ARG_FRACTION) else null
            }
            val initialLocator = fraction
                ?.let { value -> locatorAtFraction(publication, value) }
                ?: runCatching { container.epubProgress.load(bookId)?.toLocator() }.getOrNull()
            val factory = EpubNavigatorFactory(publication).createFragmentFactory(
                initialLocator = initialLocator,
                initialPreferences = EpubPreferences(
                    fontSize = 19.0,
                    lineHeight = 1.5,
                    pageMargins = 0.04,
                    theme = if (dark) Theme.DARK else Theme.LIGHT,
                ),
            )
            childFragmentManager.fragmentFactory = factory
        } else {
            // 进程被系统回收后重建：publication 只在内存里，Readium 的导航 Fragment 没有工厂
            // 就无法实例化（它没有无参构造），恢复子 Fragment 时会直接崩。
            // 用空白 Fragment 顶替那个已无法重建的导航页，页面停在空白态，由上层重新打开。
            childFragmentManager.fragmentFactory = MissingNavigatorFactory
        }
        super.onCreate(savedInstanceState)
    }

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?,
    ): View = FragmentContainerView(requireContext()).apply {
        id = R.id.epub_container
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        // 只在第一次创建时加；旋屏后由 FragmentManager 按工厂恢复
        if (savedInstanceState == null) {
            childFragmentManager.beginTransaction()
                .setReorderingAllowed(true)
                .add(R.id.epub_container, EpubNavigatorFragment::class.java, null)
                .commitNow()
        }
        (childFragmentManager.findFragmentById(R.id.epub_container) as? EpubNavigatorFragment)
            ?.let { watchLocator(it) }
    }

    /**
     * 翻页停稳就落一次盘：原来只在 onPause / onDestroyView 保存，
     * 前台崩溃会丢掉整段阅读位置。节流到 2 秒，读写都走 IO。
     */
    private fun watchLocator(navigator: EpubNavigatorFragment) {
        viewLifecycleOwner.lifecycleScope.launch {
            var pending: Job? = null
            navigator.currentLocator.collect { locator ->
                if (locator == null) return@collect
                pending?.cancel()
                pending = launch {
                    delay(LOCATOR_SAVE_DELAY_MS)
                    if (isAdded && view != null) saveProgress()
                }
            }
        }
    }

    override fun onPause() {
        super.onPause()
        saveProgress()
    }

    override fun onDestroyView() {
        saveProgress()
        super.onDestroyView()
    }

    /**
     * 全书比例（0–1）→ 最接近的 Locator。
     *
     * Readium 3 的 Publication 没有「按比例定位」的接口，这里按 readingOrder
     * 平均分摊：先选章，再把余数当成章内 progression。章节长度差异会让位置
     * 有几页误差，但作为「另一台设备读到哪」的续读落点足够。
     */
    private fun locatorAtFraction(publication: Publication, fraction: Double): Locator? {
        val links = publication.readingOrder
        if (links.isEmpty()) return null
        val total = fraction.coerceIn(0.0, 1.0) * links.size
        val index = total.toInt().coerceIn(0, links.size - 1)
        val base = publication.locatorFromLink(links[index]) ?: return null
        val inner = (total - index).coerceIn(0.0, 1.0)
        return Locator(
            href = base.href,
            mediaType = base.mediaType,
            title = base.title,
            locations = Locator.Locations(
                progression = inner,
                totalProgression = fraction.coerceIn(0.0, 1.0),
            ),
        )
    }

    /** 位置同时写本机 locator 与同步百分比，由 SessionStore 统一处理。 */
    private fun saveProgress() {
        val bookId = arguments?.getString(ARG_BOOK_ID) ?: return
        val navigator = childFragmentManager.findFragmentById(R.id.epub_container) as? EpubNavigatorFragment
        val locator = navigator?.currentLocator?.value ?: return
        (requireActivity().application as FolioApp).session.saveEpubLocator(bookId, locator)
    }

    companion object {
        private const val ARG_BOOK_ID = "bookId"
        private const val ARG_DARK = "dark"
        private const val ARG_FRACTION = "initialFraction"
        private const val LOCATOR_SAVE_DELAY_MS = 2000L

        /** 进程被回收后的兜底：无法重建的 Readium 导航 Fragment 换成空白 Fragment，避免崩溃。 */
        private object MissingNavigatorFactory : FragmentFactory() {
            override fun instantiate(classLoader: ClassLoader, className: String): Fragment =
                if (className == EpubNavigatorFragment::class.java.name) Fragment()
                else super.instantiate(classLoader, className)
        }

        fun newInstance(bookId: String, dark: Boolean, initialFraction: Double? = null): EpubHostFragment =
            EpubHostFragment().apply {
                arguments = Bundle().apply {
                    putString(ARG_BOOK_ID, bookId)
                    putBoolean(ARG_DARK, dark)
                    if (initialFraction != null) putDouble(ARG_FRACTION, initialFraction)
                }
            }
    }
}
