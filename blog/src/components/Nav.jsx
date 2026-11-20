import { Link } from '../lib/router.jsx';
import ThemeToggle from './ThemeToggle.jsx';

export default function Nav({ site }) {
  const title = site?.title || '纸间';

  return (
    <header className="nav">
      <div className="nav__inner">
        <Link href="/" className="brand" aria-label={`${title} 首页`}>
          <span className="brand__mark" aria-hidden="true">
            纸
          </span>
          <span className="brand__text">
            {title}
            <span className="brand__sub">写字的地方</span>
          </span>
        </Link>

        <nav className="nav__links" aria-label="主导航">
          <Link href="/" className="nav__link">
            文章
          </Link>
          <Link href="/admin" className="nav__link nav__link--write">
            写作
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
          </Link>
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}
