type ApiKeyInputLike = {
  value?: string | null;
} | null | undefined;

const trimString = (value: unknown): string => (
  typeof value === 'string' ? value.trim() : ''
);

export const resolveCustomProviderApiKey = (
  controlledValue: string,
  inputElement?: ApiKeyInputLike
): string => {
  const stateValue = trimString(controlledValue);
  if (stateValue) {
    return stateValue;
  }

  return trimString(inputElement?.value);
};
