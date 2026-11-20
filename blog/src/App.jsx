import { useEffect, useState } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { api } from './lib/api.js';
import { usePathname } from './lib/router.jsx';
import { ThemeProvider } from './lib/theme.jsx';
import ScrollProgress from './components/ScrollProgress.jsx';
import Nav from './components/Nav.jsx';
import Footer from './components/Footer.jsx';
import Home from './pages/Home.jsx';
import PostPage from './pages/PostPage.jsx';
import AdminPage from './pages/AdminPage.jsx';
import NotFound from './pages/NotFound.jsx';

const FALLBACK_SITE = { title: '纸间', subtitle: '关于代码、阅读与缓慢生活的笔记', author: '' };

export default function App() {
  const pathname = usePathname();
  const [site, setSite] = useState(null);

  useEffect(() => {
    api('/api/site')
      .then(setSite)
      .catch(() => setSite(FALLBACK_SITE));
  }, []);

  const isAdmin = pathname === '/admin';
  const postMatch = /^\/post\/([^/]+)\/?$/.exec(pathname);

  let page;
  if (pathname === '/') page = <Home site={site} />;
  else if (postMatch) page = <PostPage slug={decodeURIComponent(postMatch[1])} site={site} />;
  else if (isAdmin) page = <AdminPage site={site} onSiteChange={setSite} />;
  else page = <NotFound />;

  return (
    <MotionConfig reducedMotion="user">
      <ThemeProvider>
        {!isAdmin && <ScrollProgress />}
        {!isAdmin && <Nav site={site} />}
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={pathname}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
          >
            {page}
          </motion.div>
        </AnimatePresence>
        {!isAdmin && <Footer site={site} />}
      </ThemeProvider>
    </MotionConfig>
  );
}
