#version 420

precision highp float;


layout(location = 0) in vec3 position;
layout(location = 1) in vec3 normalIn;

uniform mat4 modelViewProjectionMatrix;
uniform mat4 normalMatrix;

out vec3 viewSpaceNormal;

void main(){

	gl_Position = modelViewProjectionMatrix * vec4(position, 1.0);
	viewSpaceNormal = (normalMatrix * vec4(normalIn, 0.0)).xyz;

}