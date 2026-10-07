export const getStringSize = (): void => {
	const measurementSpan = document.getElementById("container");
	const measurementSpanStyle: Record<string, any> = {};
	Object.keys(measurementSpanStyle).map((styleKey) => {
		(measurementSpan.style as Record<string, any>)[styleKey] = measurementSpanStyle[styleKey];
		return styleKey;
	});
};
