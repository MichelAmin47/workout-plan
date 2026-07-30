export default function MealCard({ title, tag, items, macros }) {
  return (
    <div className="meal-suggestion-card">
      <div className="meal-card-header">
        <div className="meal-card-title">{title}</div>
        <div className="meal-tag">{tag}</div>
      </div>
      <div className="meal-items">
        {items.map((item) => (
          <div className="meal-item" key={item.name}>
            <span className="meal-item-name">{item.name}</span>
            <span className="meal-item-detail">{item.detail}</span>
          </div>
        ))}
      </div>
      <div className="meal-macros">
        {macros.map((macro) => (
          <div className="macro" key={macro.label}>
            <div className="macro-val">{macro.val}</div>
            <div className="macro-label">{macro.label}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
