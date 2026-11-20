import { Link } from '../lib/router.jsx';
import { year } from '../lib/format.js';

export default function Footer({ site }) {
  const links = site?.links || [];

  return (
    <footer className="footer">
      <div className="footer__inner">
        <div className="footer__brand">
          <span className="footer__title">{site?.title || '纸间'}</span>
          <p>{site?.subtitle || '关于代码、阅读与缓慢生活的笔记'}</p>
        </div>

        <div className="footer__side">
          <div className="footer__links">
            {links.map((link) => (
              <a key={link.href} href={link.href} target="_blank" rel="noreferrer">
                {link.label}
              </a>
            ))}
            <Link href="/admin">写作台</Link>
          </div>
          <p className="footer__copy">
            © {year()} {site?.author || site?.title || '纸间'} · 用 React 与 motion 手写
          </p>
        </div>
      </div>
    </footer>
  );
}
