export function FollowingPlaceholder() {
  return (
    <section className="placeholder" aria-labelledby="following-heading">
      <p className="placeholder__label">Configuration</p>
      <h1 id="following-heading">Following</h1>
      <p>
        Channel configuration will live here once the follow lifecycle DAG node
        is implemented.
      </p>
      <p className="placeholder__note">
        Foundation only: there is no add, resolve, or unfollow behavior in D0.
      </p>
    </section>
  );
}
