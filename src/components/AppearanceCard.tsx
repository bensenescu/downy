import ThemePicker from "./ThemePicker";

export default function AppearanceCard() {
  return (
    <section className="card card-compact border border-base-300 bg-base-100 shadow-sm">
      <div className="card-body gap-4">
        <div>
          <h2 className="text-base font-semibold">Appearance</h2>
          <p className="text-sm text-base-content/70">
            Pick a theme. Hover any option to preview it live before committing.
            Stored locally in this browser.
          </p>
        </div>
        <ThemePicker />
      </div>
    </section>
  );
}
