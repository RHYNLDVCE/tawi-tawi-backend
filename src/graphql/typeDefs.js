const typeDefs = `#graphql
  type User {
    id: ID!
    fullName: String!
    email: String!
    status: String!
  }

  type AuthPayload {
    token: String!
    user: User!
  }

  type ServiceHandshakeResponse {
    serviceName: String!
    hasAccess: Boolean!
    requiresRegistration: Boolean! 
    message: String!
    role: String
  }

  type Query {
    me: User!
    verifyServiceAccess(serviceName: String!): ServiceHandshakeResponse!
  }

  type Mutation {
    register(fullName: String!, email: String!, password: String!): AuthPayload!
    login(email: String!, password: String!): AuthPayload!
    
    # Social Login Providers
    googleLogin(idToken: String!): AuthPayload!
    metaLogin(accessToken: String!): AuthPayload!
    
    registerForService(serviceName: String!, payload: String!): ServiceHandshakeResponse!
  }
`;

module.exports = typeDefs;