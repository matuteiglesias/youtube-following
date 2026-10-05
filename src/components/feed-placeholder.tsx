export function FeedPlaceholder() {
  return (
    <section className="placeholder" aria-labelledby="feed-heading">
      <p className="placeholder__label">Feed</p>
      <h1 id="feed-heading">Following</h1>
      <p>
        The reverse-chronological feed from channels you choose will live here.
      </p>
      <p className="placeholder__note">
        Foundation only: D0 does not load product data or call providers.
      </p>
    </section>
  );
}
