// Local browser state only; never sent as a header or request parameter.
let generation = 0
export const currentSessionGeneration = () => generation
export const advanceSessionGeneration = () => ++generation
