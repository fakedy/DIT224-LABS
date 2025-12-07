#version 420



in vec3 viewSpaceNormal;
layout(location = 0) out vec4 fragmentColor;


void main(){

	fragmentColor = vec4(viewSpaceNormal, 1.0);


}