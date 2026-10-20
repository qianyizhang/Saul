const text = (value, max = 256) =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max;

// Keep only account-advertised choices; never infer capabilities from a model name.
export function planModels(catalog) {
  if (!Array.isArray(catalog)) throw new Error('OpenAI returned an invalid account model catalog.');
  return catalog
    .filter((model) => model?.visibility === 'list' && text(model.slug))
    .map((model) => {
      const levels = model.supported_reasoning_levels ?? model.supported_reasoning_efforts;
      const efforts = Array.isArray(levels)
        ? levels.flatMap((level) => {
            const effort = level?.effort ?? level?.reasoning_effort;
            return text(effort, 64)
              ? [
                  {
                    effort,
                    description: typeof level.description === 'string' ? level.description : '',
                  },
                ]
              : [];
          })
        : [];
      const tiers = Array.isArray(model.service_tiers) ? model.service_tiers : [];
      const speeds = Array.isArray(model.additional_speed_tiers)
        ? model.additional_speed_tiers
        : [];
      const fastTier =
        tiers.find(
          (tier) =>
            text(tier?.id) &&
            (['fast', 'priority'].includes(tier.id) ||
              (typeof tier.name === 'string' && tier.name.toLowerCase() === 'fast')),
        )?.id ?? speeds.find((tier) => tier === 'fast' || tier === 'priority');
      const defaultEffort = model.default_reasoning_level ?? model.default_reasoning_effort;
      return {
        slug: model.slug,
        display_name: text(model.display_name, 1000) ? model.display_name : model.slug,
        supportedReasoningEfforts: efforts.filter(
          (level, index) => efforts.findIndex((other) => other.effort === level.effort) === index,
        ),
        defaultReasoningEffort: text(defaultEffort, 64) ? defaultEffort : '',
        ...(fastTier ? { fastTier } : {}),
        isDefault: model.is_default === true,
      };
    });
}

export function planModelIssue(settings, models) {
  const model = models.find((option) => option.slug === settings.model);
  if (!model)
    return 'The saved model is unavailable for this ChatGPT account. Choose an available model.';
  if (
    settings.effort &&
    !model.supportedReasoningEfforts.some((level) => level.effort === settings.effort)
  )
    return `The saved effort “${settings.effort}” is unavailable for ${model.display_name}. Choose an available effort.`;
  if (settings.fast && !model.fastTier)
    return `Fast is unavailable for ${model.display_name}. Choose Standard or another model.`;
  return undefined;
}

// Used only when explicitly choosing a model or initializing an empty configuration.
export function planModelDefaults(model) {
  const choices = model.supportedReasoningEfforts.map((level) => level.effort);
  const effort =
    ['none', 'minimal', 'low'].find((choice) => choices.includes(choice)) ??
    (choices.includes(model.defaultReasoningEffort) ? model.defaultReasoningEffort : choices[0]) ??
    '';
  return { effort, fast: false };
}
