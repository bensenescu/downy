import ThemePicker from "./ThemePicker";

export default function AppearanceCard() {
  return (
    <section className="card card-compact border border-base-300 bg-base-100 shadow-sm">
      <div className="card-body gap-4">
        <h2 className="text-base font-semibold">Appearance</h2>
        <ThemePicker />
      </div>
    </section>
  );
}
