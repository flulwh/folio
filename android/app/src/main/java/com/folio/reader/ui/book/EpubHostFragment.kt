package com.folio.reader.ui.book

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.fragment.app.Fragment
import androidx.fragment.app.FragmentContainerView
import androidx.fragment.app.commit
import com.folio.reader.FolioApp
import com.folio.reader.R
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
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
            val factory = EpubNavigatorFactory(publication).createFragmentFactory(
                initialLocator = runCatching {
                    container.epubProgress.load(bookId)?.toLocator()
                }.getOrNull(),
                initialPreferences = EpubPreferences(
                    fontSize = 19.0,
                    lineHeight = 1.5,
                    pageMargins = 0.04,
                    theme = if (dark) Theme.DARK else Theme.LIGHT,
                ),
            )
            childFragmentManager.fragmentFactory = factory
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
            childFragmentManager.commit {
                setReorderingAllowed(true)
                add(R.id.epub_container, EpubNavigatorFragment::class.java, null)
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

    /** 位置只在本机：小 JSON，IO 线程写，失败不影响阅读。 */
    private fun saveProgress() {
        val bookId = arguments?.getString(ARG_BOOK_ID) ?: return
        val navigator = childFragmentManager.findFragmentById(R.id.epub_container) as? EpubNavigatorFragment
        val locator = navigator?.currentLocator?.value ?: return
        val store = (requireActivity().application as FolioApp).container.epubProgress
        CoroutineScope(Dispatchers.IO).launch {
            runCatching { store.save(bookId, locator) }
        }
    }

    companion object {
        private const val ARG_BOOK_ID = "bookId"
        private const val ARG_DARK = "dark"

        fun newInstance(bookId: String, dark: Boolean): EpubHostFragment =
            EpubHostFragment().apply {
                arguments = Bundle().apply {
                    putString(ARG_BOOK_ID, bookId)
                    putBoolean(ARG_DARK, dark)
                }
            }
    }
}
