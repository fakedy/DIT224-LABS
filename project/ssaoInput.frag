#version 420



in vec3 viewSpaceNormal;
layout(location = 0) out vec4 fragmentColor;


void main(){

	vec3 normal = normalize(viewSpaceNormal);
	fragmentColor = vec4(normal * 0.5 + 0.5, 1.0);


}