import { Link } from '../lib/router.jsx';

export default function NotFound() {
  return (
    <main className="not-found">
      <span className="not-found__code">404</span>
      <h1>这里什么都没有</h1>
      <p>可能是链接写错了，也可能这篇文章还没被写出来。</p>
      <Link href="/" className="btn btn--primary">
        回到首页
      </Link>
    </main>
  );
}
